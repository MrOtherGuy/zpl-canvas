// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: Copyright 2025 MrOtherGuy

function EAN13UPCWidths(def){
  if(!/^\d{12,13}$/.test(def.text)){
    throw new Error("input is not valid EAN-13 or UPC-A")
  }
  const text = def.text.length === 12
    ? `0${def.text}`
    : def.text;
  // 12 * 4 byte chars, 5 for center marker, 3 for start and end marker
  let patterns = new Uint8Array(12 * 4 + 5 + 3 + 3); // length = 59
  patterns.set([1,1,1],0);
  patterns.set([1,1,1],56);
  let codeTypes = new Uint8Array(EAN13CodeTypes.buffer,Number.parseInt(text[0]) * 6,6); // slice into codeTypes buffer
  for(let i = 0; i < 6; i++){
    let mode = codeTypes[i];
    let num = Number.parseInt(text[i+1]);
    if(mode === 1){
      patterns[3 + i * 4 + 0] = RCodes[num * 4 + 0];
      patterns[3 + i * 4 + 1] = RCodes[num * 4 + 1];
      patterns[3 + i * 4 + 2] = RCodes[num * 4 + 2];
      patterns[3 + i * 4 + 3] = RCodes[num * 4 + 3];
    }else{
      patterns[3 + i * 4 + 0] = RCodes[num * 4 + 3];
      patterns[3 + i * 4 + 1] = RCodes[num * 4 + 2];
      patterns[3 + i * 4 + 2] = RCodes[num * 4 + 1];
      patterns[3 + i * 4 + 3] = RCodes[num * 4 + 0];
    }
  }
  patterns.set([1,1,1,1,1],27);
  for(let i = 0; i < 6; i++){
    let num = Number.parseInt(text[i+7]);
    patterns[32 + i * 4 + 0] = RCodes[num * 4 + 0];
    patterns[32 + i * 4 + 1] = RCodes[num * 4 + 1];
    patterns[32 + i * 4 + 2] = RCodes[num * 4 + 2];
    patterns[32 + i * 4 + 3] = RCodes[num * 4 + 3];
  }
  return patterns
}
// 1 = type L, 2 = type R
const EAN13CodeTypes = Uint8Array.from([
  1,1,1,1,1,1,
  1,1,2,1,2,2,
  1,1,2,2,1,2,
  1,1,2,2,2,1,
  1,2,1,1,2,2,
  1,2,2,1,1,2,
  1,2,2,2,1,1,
  1,2,1,2,1,2,
  1,2,1,2,2,1,
  1,2,2,1,2,1
]);
const RCodes = Uint8Array.from([
  3,2,1,1,
  2,2,2,1,
  2,1,2,2,
  1,4,1,1,
  1,1,3,2,
  1,2,3,1,
  1,1,1,4,
  1,3,1,2,
  1,2,1,3,
  3,1,1,2
]);
export function createBarcodePattern(def){
  if(typeof def?.text != "string"){
    throw new Error("property text is not string")
  }
  switch(def.type){
    case "Code128":
      return createCode128Widths(def);
    case "EAN":
    case "UPC":
      return EAN13UPCWidths(def);
  }
  return []
}
function createCode128Widths(def){
  
  // only optimization we do is check if everything is numeric then we use type C
  // otherwise use type B
  const aString = def.text;
  if(aString.length === 0){
    return []
  }
  const isNumeric = /^\d*$/.test(aString) && aString.length > 3;
  const typeValue = isNumeric ? 105 : 104;
  
  let codeValues;
  if(isNumeric){
  let parts = aString.split(/(\d\d)/).filter(a=>a);
  let last = parts.pop();
  codeValues = parts.map(cc => Number.parseInt(cc));
  if(aString.length & 0x1){
    codeValues.push(100); // switch to type B
    codeValues.push(last.charCodeAt(0) - 32);
  }else{
    codeValues.push(Number.parseInt(last))
  }
  }else{
    codeValues = aString.split("").map(c => c.charCodeAt(0) - 32);
  }

  let patterns = [Code128Cache.getPatternForValue(typeValue)];
  for(let code of codeValues){
    patterns.push(Code128Cache.getPatternForValue(code))
  }
  let checksum = codeValues.reduce((a,b,i) => a + b * (i+1),typeValue) % 103;
  patterns.push(Code128Cache.getPatternForValue(checksum));
  patterns.push(Code128PatternCache.stopPattern);
  return patterns
}
/** These are computed from  
 * https://en.wikipedia.org/wiki/Code_128 Bar/Space width
 * strings (eg. 212222) by applying transform: 
 *   string
 *   .map(char => Number.parseInt(char) - 1)
 *   .reduce((a,b,i) => a + (b << (i * 2)), 0)
 */
const Code128Patterns = Uint16Array.from([1361,1301,341,2372,1412,1352,2132,1172,1112,2117,1157,1097,1616,1556,596,1376,1316,356,101,1541,581,1121,1061,530,1346,1286,326,1106,1046,86,2321,401,281,2432,2312,392,2192,2072,152,2177,2057,137,2576,656,536,2336,416,296,290,641,521,2081,161,545,2306,386,266,2066,146,26,50,197,11,3392,1472,3332,452,1292,332,3152,1232,3092,212,1052,92,77,3077,35,1037,56,1856,1796,836,1136,1076,116,1091,1031,71,785,305,275,2816,896,776,2096,176,2051,131,800,560,770,515,1217,3137,1601,41]);

class Code128PatternCache{
  constructor(){
    this.cache = new Map();
  }
  getPatternForValue(x){
    let cached = this.cache.get(x);
    if(cached){
      return cached
    }
    let i = Code128PatternCache.getPatternForValue(x);
    this.cache.set(x,i)
    return i
  }
  static getPatternForValue(aValue){
    let pattern = Code128Patterns[aValue];
    return Uint8Array.from([
    pattern & 0b11,
    (pattern & 0b1100) >> 2,
    (pattern & 0b110000) >> 4,
    (pattern & 0b11000000) >> 6,
    (pattern & 0b1100000000) >> 8,
    (pattern & 0b110000000000) >> 10
    ],a => a+1)
  }
  static stopPattern = Uint8Array.from([2,3,3,1,1,1,2]);
}

export const Code128Cache = new Code128PatternCache();