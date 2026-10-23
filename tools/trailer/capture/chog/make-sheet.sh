#!/bin/bash
# NFT art PNGs + the contact sheet (one headless browser each, sequentially).
S=/tmp/chog-trailer
node -e '
const S=process.argv[1], toks=[1798,824,285,1699];
const fs=require("fs");
fs.writeFileSync(S+"/bl/tools/conv.json",JSON.stringify({convert:toks.map(t=>({file:S+"/bl/nft/raw/"+t+".webp",out:S+"/bl/nft/"+t+".png"}))}));
const items=[];
for(const f of [0,19,38,57,76,95]) items.push({file:S+"/bl/out/frames/nft-run/"+String(f).padStart(4,"0")+".png",label:"nft-run "+f});
for(const t of toks){ items.push({file:S+"/bl/nft/raw/"+t+".webp",label:"NFT #"+t+(t===1798?" (Legendary 1:1)":"")});
  for(const f of [0,12,24,36,47]) items.push({file:S+"/bl/out/frames/nft-turn-"+t+"/"+String(f).padStart(4,"0")+".png",label:"turn-"+t+" "+f}); }
fs.writeFileSync(S+"/bl/tools/sheet.json",JSON.stringify({out:S+"/bl/nft-sheet.png",cols:6,cell:[360,240],checker:true,title:"Chog trailer: nft-run (1920x1080, 96f) and nft-turn-<token> (1080x1080 alpha, 48f), 24 fps",items}));
' $S
node $S/bl/tools/sheet.mjs $S/bl/tools/conv.json
node $S/bl/tools/sheet.mjs $S/bl/tools/sheet.json
