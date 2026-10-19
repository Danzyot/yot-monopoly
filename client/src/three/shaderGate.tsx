/// <reference types="vite/client" />
// Shader compiles kept off the main thread.
//
// Linking a shader program is the slowest thing the scene does: on Windows,
// Chrome translates every shader to HLSL first, and a physical material takes
// a good fraction of a second. The link itself runs in the GPU process; the
// page only waits when three asks about a program that is still linking: the
// error logs it reads in debug mode, and the uniform list it reads the first
// time the program draws. So:
//
//   - setupRenderer turns the debug reads off outside development;
//   - ShaderGate compiles anything new in the scene before it is drawn
//     (renderer.compile, the path compileAsync takes) and keeps its materials
//     hidden until the program has linked, so the frame loop never waits on
//     one. Hidden objects are compiled too, so props that appear later (a
//     doubles flash, a hat, a cutscene's pockets) are ready when they do.
//
// With KHR_parallel_shader_compile (Chrome on Windows, macOS, most desktops)
// the driver links in the background and says when each program is done.
// Without it, the gate starts one new program a frame and reads it back the
// frame after: the GPU process links it while the page gets on with the
// frame, and a page that does wait waits for one program at a time, not the
// whole scene at once, so clicks and typing still get through.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import type { Camera, Material, Object3D, Scene, WebGLRenderer } from 'three';

/** Production defaults for every Canvas: no blocking shader-log reads. */
export function setupRenderer(gl: WebGLRenderer) {
  if (!import.meta.env.DEV) gl.debug.checkShaderErrors = false;
}

interface Program { isReady(): boolean; getUniforms(): unknown }
interface MaterialState { programs?: Map<string, Program> }

type Drawable = Object3D & { material?: Material | Material[] };

const materialsOf = (o: Drawable): Material[] => (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []);
const programsOf = (gl: WebGLRenderer, m: Material) => (gl.properties.get(m) as MaterialState).programs;

/** Still in the scene (not unmounted while it waited). */
function attached(o: Object3D, scene: Scene): boolean {
  let p: Object3D = o;
  while (p.parent) p = p.parent;
  return p === scene;
}

/** Not hidden itself or by a parent. */
function shownInWorld(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Materials hidden together, shown together once the objects they came with are all compiled and linked. */
interface Batch { mats: Set<Material>; left: number }

class Gate {
  /** Each drawable and the material(s) it was last checked with. */
  private seen = new WeakMap<Object3D, Material | Material[]>();
  /** Programs known to have finished linking. */
  private done = new WeakSet<Program>();
  private batches: Batch[] = [];
  /** New objects with brand-new materials, waiting their turn to compile: those on show first, then hidden ones (props for later). */
  private queue: { o: Drawable; batch: Batch }[] = [];
  private later: { o: Drawable; batch: Batch }[] = [];
  private some: Drawable[] = [];
  /** Hands renderer.compile just `some` (it walks `traverse`, and `traverseVisible` for lights of its own). */
  private root = {
    traverse: (cb: (o: Object3D) => void) => { for (const o of this.some) cb(o); },
    traverseVisible: () => {},
  } as unknown as Object3D;

  constructor(private parallel: boolean) {}

  private compile(gl: WebGLRenderer, scene: Scene, camera: Camera, objects: Drawable[]) {
    this.some = objects;
    gl.compile(this.root, camera, scene);
    this.some = [];
  }

  /** Every program the material has (one per kind of object it is drawn on) has linked. */
  private linked(gl: WebGLRenderer, m: Material): boolean {
    const programs = programsOf(gl, m);
    if (programs) for (const p of programs.values()) if (!this.done.has(p)) return false;
    return true;
  }

  frame(gl: WebGLRenderer, scene: Scene, camera: Camera) {
    // Programs that have linked since the last frame. Without the extension,
    // reading the uniforms waits for the link: last frame's one program.
    for (const p of (gl.info.programs ?? []) as unknown as Program[]) {
      if (this.done.has(p)) continue;
      if (this.parallel ? p.isReady() : (p.getUniforms(), true)) this.done.add(p);
    }
    // Show the batches that are through.
    this.batches = this.batches.filter(b => {
      if (b.left > 0) return true;
      for (const m of b.mats) if (!this.linked(gl, m)) return true;
      for (const m of b.mats) m.visible = true;
      return false;
    });

    // Anything new (or given a new material) since the last frame.
    // What is on show comes up as one; hidden props are a batch of their own,
    // compiled after, so they never hold the scene back.
    const known: Drawable[] = [];
    const batch: Batch = { mats: new Set(), left: 0 };
    const props: Batch = { mats: new Set(), left: 0 };
    scene.traverse(o => {
      const d = o as Drawable;
      if (!d.material || this.seen.get(d) === d.material) return;
      this.seen.set(d, d.material);
      const mats = materialsOf(d);
      if (mats.every(m => programsOf(gl, m))) { known.push(d); return; }
      const shown = shownInWorld(d);
      const b = shown ? batch : props;
      // Brand-new materials are not on screen anywhere yet: hidden until compiled.
      for (const m of mats) if (m.visible && !programsOf(gl, m)) { m.visible = false; b.mats.add(m); }
      (shown ? this.queue : this.later).push({ o: d, batch: b });
      b.left++;
    });
    // Materials already in use (a figure's colours on a new mesh, a clone) are
    // compiled at once: they mostly share programs that have already linked.
    if (known.length) {
      this.compile(gl, scene, camera, known);
      for (const o of known) for (const m of materialsOf(o)) if (m.visible && !this.linked(gl, m)) { m.visible = false; batch.mats.add(m); }
    }
    for (const b of [batch, props]) if (b.left || b.mats.size) this.batches.push(b);

    // The queue: all at once with background linking, else until one new program is linking.
    if (this.parallel) {
      const all = [...this.queue, ...this.later];
      this.compile(gl, scene, camera, all.filter(q => attached(q.o, scene)).map(q => q.o));
      for (const q of all) q.batch.left--;
      this.queue.length = this.later.length = 0;
      return;
    }
    for (let next; (next = this.queue.shift() ?? this.later.shift());) {
      const { o, batch: b } = next;
      b.left--;
      if (!attached(o, scene)) continue;
      const before = gl.info.programs?.length ?? 0;
      this.compile(gl, scene, camera, [o]);
      if ((gl.info.programs?.length ?? 0) > before) break;
    }
  }

  /** Unmounting: give back anything still hidden. */
  release() {
    for (const b of this.batches) for (const m of b.mats) m.visible = true;
    this.batches = [];
    this.queue = [];
    this.later = [];
  }
}

/**
 * Mount once inside a Canvas. It renders the frame itself (priority 1), right
 * after every other frame callback, so nothing added during the frame slips
 * past it.
 */
export function ShaderGate() {
  const gl = useThree(s => s.gl);
  const gate = useMemo(() => new Gate(gl.extensions.has('KHR_parallel_shader_compile')), [gl]);
  useEffect(() => () => gate.release(), [gate]);
  useFrame(({ gl, scene, camera }) => {
    gate.frame(gl, scene, camera);
    gl.render(scene, camera);
  }, 1);
  return null;
}
