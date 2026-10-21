// Chog Genesis facts that need no trait table: the supply, the contract and a
// token's name. The home page (daily.ts, the Chog of the Day card) reads these
// without pulling in traits.ts and its 318 KB tokens.json; traits.ts re-exports
// them, so everything else keeps importing from there.

export const CHOG_SUPPLY = 1969;
export const CHOG_CONTRACT = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';

export const chogName = (tokenId: number) => `Chog #${tokenId}`;

/** A token's page on OpenSea (the wallet page, the Chog of the Day, the Discord bot's /chog). */
export const openSeaUrl = (tokenId: number, contract = CHOG_CONTRACT) => `https://opensea.io/item/monad/${contract}/${tokenId}`;
