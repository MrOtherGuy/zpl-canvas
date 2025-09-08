// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: Copyright 2024-2025 MrOtherGuy

import { createBarcodePattern } from "./barcodePatternGenerator.js";

class ZPLCommand{
  constructor(str,type){
    this.text = str.slice(type.length);
    this.type = type;
    this.hasTemplate = /\$\{.+\}/.test(this.text);
    if(!(type === "A" || type.length === 2)){
      throw new Error(`invalid command - must be either "A" or 2 characters - found "^${this.type}"`)
    }
  }
  get templateContent(){
    return this.hasTemplate ? { type: "text", id: this.text.match(/\$\{(.+)\}/)?.[1], value: undefined } : null
  }
  parameters(){
    const arr = this.text.split(/\s*,\s*/).map(a => /^\d+$/.test(a) ? Number.parseInt(a) : a);
    return arr.values()
  }
  requireParams(min,max = 10){
    let count = this.text.split(/\s*,\s*/).length;
    if(count < min || count > max){
      throw new Error(`invalid parameter count in "^${this.type}${this.text}"`)
    }
  }
  draw(){
    return this.ok()
  }
  toError(msg){
    return { command: `^${this.type}${this.text}`, ok: false, reason: msg }
  }
  ok(){
    return { command: `^${this.type}${this.text}`, ok: true }
  }
  stringify(template){
    return this.hasTemplate
      ? `^${this.type}${template.get(this.text) || ""}`
      : `^${this.type}${this.text}`
  }
  static iterateOnce(cmd){
    let i = 0;
    return {
      next(){
        return {value: cmd.text, done: i++ > 0}
      },
      [Symbol.iterator](){
        return this
      }
    }
  }
}
class ZPLUnknownCommand extends ZPLCommand{
  constructor(str,type){
    super(str,type)
  }
  draw(){
    console.log(this.type,this.text);
    return this.toError("unknown command")
  }
}
class ZPLWritingMode{
  constructor(){
    
  }
  static INLINE = 1;
  static BLOCK = 2;
}
class FieldOrigin{
  #coordinates;
  constructor(x,y,z){
    this.#coordinates = Uint16Array.of(x,y,z)
  }
  getAdjustedPosition(globalOffsets){
    return Uint16Array.of(
      this.#coordinates[0] + globalOffsets[0],
      this.#coordinates[1] + globalOffsets[1],
      this.#coordinates[2]
    )
  }
}
class ZPLField extends ZPLCommand{
  #commands;
  #isClosed;
  constructor(str,type){
    super(str,type);
    let params = [...this.parameters()];
    if(params.length < 2 || params.length > 3 || !params.every(a => (typeof a === "number"))){
      throw new Error(`invalid ^FO command: "${str}"`);
    }
    this.origin = new FieldOrigin(...params);
    this.#commands = [];
  }
  get writingMode(){
    return this.isTextField()
            ? this.#commands.every(a => a.type != "FB")
              ? ZPLWritingMode.INLINE
              : ZPLWritingMode.BLOCK
            : null          
  }
  draw(context,config,globalOffsets){
    context.textBaseline = "top";
    let composite = context.globalCompositeOperation;
    let fd = null;
    let fontStyle = context.font;
    let fieldSpecificFont = null;
    const isTextField = this.isTextField();
    const origin = this.origin.getAdjustedPosition(globalOffsets);
    
    let results = this.#commands
    .map((command,idx) => {
      if(command instanceof ZPLFieldDataCommand){
        // This is kinda weird, but we store the ^FD command to be drawn only after all other commands inside the field are executed
        fd = {index: idx, cmd:command}
        return {dummy:true}
      }else if(command.type === "CF"){
        // CF inside a field modifies the global font but does not affect text inside field that is configured as barcode - it does affect pure text fields though
        let font = context.font;
        let result = command.draw(context,config,origin);
        fontStyle = context.font;
        if(!isTextField){
          context.font = font
        }
        return result
      }
      let result = command.draw(context,config,origin);
      if(command.type === "A"){
        fieldSpecificFont = context.font
      }
      return result
    });
    
    if(!isTextField && !fieldSpecificFont){
      context.font = "normal 36px monospace";
    }
    if(fd){
      results[fd.index] = fd.cmd.draw(
        context,
        config,
        origin,
        this.writingMode === ZPLWritingMode.BLOCK
                            ? config.get("block_size")
                            : null,
        isTextField
          ? TextTransforms.get(config.get("text_transform"))
          : TextTransformN
      );
    }
    context.font = fontStyle;
    context.globalCompositeOperation = composite;
    config.delete("symbol_options");
    config.delete("block_size");
    config.delete("text_transform");
    results.unshift(this.ok());
    return results
  }
  isTextField(){
    return this.#commands.every(a => !(a instanceof ZPLSymbolTypeCommand))
  }
  get templateContent(){
    return this.templateFields
  }
  get templateFields(){
    return this.hasTemplate
      ? this.#commands.filter(c => c.hasTemplate).map(c => c.templateContent)
      : []
  }
  addCommand(str,type){
    if(str instanceof ZPLCommand){
      this.#commands.push(str)
    }else if(str.trim().length){
      this.#commands.push(new ZPLUnknownCommand(str,type));
    }
  }
  stringify(config,globalOffsets){
    let o = this.origin.getAdjustedPosition(globalOffsets);
    return `^FO${o[0]},${o[1]}${this.#commands.map(c => c.stringify(config)).join("")}^FS`
  }
  static close(zplField){
    if(zplField.#isClosed){
      return
    }
    zplField.hasTemplate = !!zplField.#commands.find(c => c.hasTemplate);
    zplField.#isClosed = true;
    return zplField
  }
}
class ZPLGraphicsFieldCommand extends ZPLCommand{
  #hash;
  constructor(str,type){
    super(str,type)
  }
  get templateContent(){
    return this.hasTemplate ? { type: "image", id: this.text.match(/\$\{(.+)\}/)?.[1], value: undefined } : null
  }
  stringify(template){
    return this.hasTemplate
      ? `^GF${template.get(this.text) || ""}`
      : `^GF${this.text}`
  }
  get hash(){
    if(this.hasTemplate){
      return null
    }
    if(!this.#hash){
      this.#hash = ZPLGraphicsFieldCommand.computeImageHash(this.text)
    }
    return this.#hash;
  }
  draw(context,config,origin){
    if(this.hasTemplate){
      let input = config.get(this.text);
      if(!input){
        return this.toError("templated image is undefined")
      }
      let cachedBitmap = config.get(input);
      if(cachedBitmap){
        context.drawImage(cachedBitmap,origin[0],origin[1]);
        return this.ok()
      }
    }else{
      let cachedBitmap = config.get(this.hash);
      if(cachedBitmap){
        context.drawImage(cachedBitmap,origin[0],origin[1]);
        return this.ok()
      }
    }
    // This path isn't supposed to be taken unless something goes wrong
    console.warn("Some caller has failed to create a bitmap for me");
    let specs;
    try{
      specs = ZPLGraphicsFieldCommand.parseImageDefinition(this.hasTemplate ? context.get(this.text) : this.text);
    }catch(ex){
      return this.toError(ex.message)
    }
    let imageData = ZPLGraphicsFieldCommand.stringToImageData(specs);
    let gco = context.globalCompositeOperation;
    // If we end up here, then the preview will be slightly incorrect because the image will draw on top of everything else
    createImageBitmap(imageData)
    .then(bitmap => {
      let i = context.globalCompositeOperation;
      context.globalCompositeOperation = gco;
      context.drawImage(bitmap,origin[0],origin[1]);
      context.globalCompositeOperation = i;
    });
    return this.ok()
  }
  static parseImageDefinition(data){
    if(data.startsWith("${")){
      throw new Error("templated image is undefined")
    }
    let idx = 0;
    {
      let i = 0;
      while(i < 4){
        if(data[idx] === ","){
          i++
        }
        if(idx >= data.length){
          throw new Error("too few arguments")
        }
        idx++
      }
    }
    let parts = data.slice(0,idx).split(",")
    let mode = parts[0];
    if(!/[Aa]/.test(mode)){
      throw new Error(`unsupported graphics mode "${mode}"`)
    }
    if(!/[\d+]/.test(parts[1])){
      throw new Error(`unsupported graphics databytes length "${parts[1]}"`)
    }
    let byteLength = Number.parseInt(parts[1]);
    // parts[2] = totalBytes - which equals byteLength in mode A

    if(!/[\d+]/.test(parts[3])){
      throw new Error(`unsupported graphics width "${parts[3]}"`)
    }
    return {
      widthInBytes: parts[3],
      text: data.slice(idx),
      byteLength: byteLength,
      totalBytes: byteLength
    }
  }
  static stringToImageData(def){
    const { widthInBytes, text, totalBytes } = def;
    const height = totalBytes / widthInBytes;
    let imageData = new ImageData(widthInBytes * 8, height * 8);
    const { data } = imageData;
    let i = 0;
    const byteWidth = widthInBytes * 8 * 4;
    for(let y = 0; y < height; y++){
      for(let x = 0; x < widthInBytes * 2; x++){
        let char = text[i++];
        if(i >= text.length){
          return imageData
        }
        if(char === ":"){
          if(y > 0 && x === 0){
            data.copyWithin(y * byteWidth,(y-1) * byteWidth,y * byteWidth);
            break
          }else{
            console.warn(`invalid ":" character @ ${i}`)
            return imageData
          }
        }
        if(char === ","){
          break
        }
        let nibble = Number.parseInt(char,16);
        if(Number.isNaN(nibble)){
          console.warn(`invalid character "${char}" @ ${i}`);
          return imageData
        }
        data[(byteWidth*y) + (x*16) + 3] = ((nibble & 0b1000) >> 3) * 255;
        data[(byteWidth*y) + (x*16) + 7] = ((nibble & 0b0100) >> 2) * 255;
        data[(byteWidth*y) + (x*16) + 11] = ((nibble & 0b0010) >> 1) * 255;
        data[(byteWidth*y) + (x*16) + 15] = (nibble & 0b0001) * 255;
      }
    }
    return imageData
  }
  static computeImageHash(str){
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash *= 0x5bd1e995;
      hash ^= hash >> 15
    }
    return hash; 
  }
}
class TextTransformN{
  static apply(){
    return
  }
  static reset(){
    return
  }
}
class TextTransformR{
  static apply(ctx,x,y,w,h){
    ctx.translate(x,y);
    ctx.rotate(Math.PI/2);
    ctx.translate(-x,-y-h);
  }
  static reset(ctx,x,y,w,h){
    ctx.translate(x,y+h);
    ctx.rotate(Math.PI/-2);
    ctx.translate(-x,-y);
  }
}
class TextTransformI{
  static apply(ctx,x,y,w,h){
    ctx.translate(x,y);
    ctx.rotate(Math.PI);
    ctx.translate(-x-w,-y-h);
  }
  static reset(ctx,x,y,w,h){
    ctx.translate(x+w,y+h);
    ctx.rotate(-Math.PI);
    ctx.translate(-x,-y);
  }
}
class TextTransformB{
  static apply(ctx,x,y,w,h){
    ctx.translate(x,y);
    ctx.rotate(Math.PI * 1.5);
    ctx.translate(-x-w,-y);
  }
  static reset(ctx,x,y,w,h){
    ctx.translate(x+w,y);
    ctx.rotate(Math.PI * -1.5);
    ctx.translate(-x,-y);
  }
}
const TextTransforms = new Map([
["I",TextTransformI],
["N",TextTransformN],
["B",TextTransformB],
["R",TextTransformR]
]);

class ZPLFieldDataCommand extends ZPLCommand{
  constructor(str,type){
    super(str,type);
  }
  parameters(){
    return ZPLCommand.iterateOnce(this)
  }
  textSize(context){
    return Number.parseInt(context.font.match(/\d+/)) || 20
  }
  ok(){
    return { command: `^${this.type}${[...this.parameters()].join(",")}`, ok: true }
  }
  draw(context,config,origin,blockSize,transformation){
    let symbol = config.get("symbol_options");
    let y_origin = origin[1];
    let textOrigin = origin[0];
    const text = config.get(this.text) || this.text;
    const skipDraw = /^\$\{/.test(text);
    
    if(skipDraw){
      if(symbol){
        y_origin += symbol?.height || config.get("height") || 10;
        textOrigin += (config.get("module_width") || 2) >> 1;
      }
    }else{
      if(symbol?.type){
        let size = symbol.type.renderFake(context,origin,config,symbol,text);
        
        if(![ZPLSymbolTypeBC,ZPLSymbolTypeBEBU].includes(symbol.type)){
          // we can return since symbol types other than code128 don't print text
          return this.ok()
        }
        y_origin += size[1] + 10;
        textOrigin += (size[0] >> 1);
        context.textAlign = "center";
      }
    }
    if(symbol?.line != "N"){
      // This branch will also draw the "normal" textfield text
      if(blockSize){
        // this is only ever true if on pure text fields
        let block = ZPLFieldDataCommand.measureTextBlock(context,blockSize,text);
        const originalY = y_origin;
        transformation?.apply(context,textOrigin,originalY,blockSize.w,block.lines.length * block.lineHeight);
        for(let line of block.lines){
          context.fillText(line,textOrigin,y_origin);
          y_origin += block.lineHeight;
        }
        transformation?.reset(context,textOrigin,originalY,blockSize.w,block.lines.length * block.lineHeight);
      }else{
        let measured = context.measureText(text);
        transformation?.apply(context,textOrigin,y_origin,measured.width,measured.emHeightDescent);
        context.fillText(text,textOrigin,y_origin);
        transformation?.reset(context,textOrigin,y_origin,measured.width,measured.emHeightDescent);
      }
    }
    if(symbol?.lineAbove === "Y"){
      context.fillText(text,textOrigin,origin[1] - this.textSize(context));
    }
    context.textAlign = "left";
    return this.ok()
  }
  static measureTextBlock(ctx,blockSize,text){
    if(blockSize.h < 1){
      return {lineHeight: 0, lines:[]}
    }
    let textSize = ctx.measureText(text);
    const lineHeight = Math.ceil(textSize.emHeightDescent);
    if(textSize.width <= blockSize.w){
      return {lineHeight: lineHeight,lines: [text]}
    }
    
    let simpleParts = text.split("\\&").slice(0,blockSize.h);
    if(simpleParts.every(s => ctx.measureText(s).width <= blockSize.w)){
      return {lineHeight: lineHeight,lines: simpleParts}
    }
    let linesToDraw = [];
    
    let slice = simpleParts.shift();
    let parts = slice.split(/\s/);
    let constructed = [parts[0]];
    let previousWidth = ctx.measureText(constructed[0]).width;
    if(previousWidth > blockSize.w){
      console.log("first line is too long to fit");
      return {lineHeight: lineHeight, lines:[]}
    }
    const wsw = ctx.measureText(" ").width;
    let i = 0;
    let idx = 0;
    const AVAIL_WIDTH = blockSize.w;
    const AVAIL_LINES = blockSize.h;
    while(i < AVAIL_LINES){
      if(idx >= parts.length){
        i++;
        if(i >= AVAIL_LINES){
          break
        }
        idx=0;
        linesToDraw.push(constructed.join(" "));
        constructed = [];
        slice = simpleParts.shift();
        if(!slice){
          break
        }
        parts = slice.split(/\s/);
        continue
      }
      if(idx >= (parts.length - 1)){
        if(i <= AVAIL_LINES){
          linesToDraw.push(constructed.join(" "));
          break;
        }
        constructed = [];
        slice = simpleParts.shift();
        if(!slice){
          break
        }
        i++;
        idx = 0;
        parts = slice.split(/\s/);
        continue;
      }
      let newPart = wsw + ctx.measureText(parts[++idx]).width;
      if((previousWidth + newPart) <= AVAIL_WIDTH){
        previousWidth += newPart;
        constructed.push(parts[idx]);
      }else{
        linesToDraw.push(constructed.join(" "));
        constructed = [parts[idx]];
        previousWidth = newPart;
        i++;
      }
    }
    return {lineHeight: lineHeight, lines:linesToDraw}
  }
}
class ZPLFieldSerialDataCommand extends ZPLCommand{
  constructor(str,type){
    super(str,type)
  }
  draw(){
    return this.ok()
  }
}
class ZPLFieldModifierCommand extends ZPLCommand{
  constructor(str,type){
    super(str,type);
  }
  draw(context,config){
    if(this.type === "FR"){
      context.globalCompositeOperation = "xor";
      return this.ok()
    }
    if(this.type === "FB"){
      // TODO ^FB has three other params as well
      let params = [...this.parameters()]
      config.set("block_size",{w: Number.parseInt(params[0]) || 0,h: Number.parseInt(params[1]) || 1});
      return this.ok()
    }
    return this.ok()
  }
}
class ZPLSymbolTypeCommand extends ZPLCommand{
  constructor(str,type){
    super(str.trimEnd(),type);
    this.requireParams(0,6);
  }
  static create(str,type){
    if(type === "BC"){
      return new ZPLSymbolTypeBC(str,type)
    }
    if(type === "BE" || type === "BU"){
      return new ZPLSymbolTypeBEBU(str,type)
    }
    if(type === "BQ"){
      return new ZPLSymbolTypeBQ(str,type)
    }
    if(type === "BX"){
      return new ZPLSymbolTypeBX(str,type)
    }
    return new ZPLSymbolTypeCommand(str,type)
  }
  static renderFake(){
    console.log("unimplemented fake render");
    return [0,0]
  }
}
class ZPLSymbolTypeBEBU extends ZPLSymbolTypeCommand{
  constructor(str,type,container){
    super(str,type,container);
    this.requireParams(0,6);
  }
  draw(_,config){
    let [orientation,height,line,lineAbove,checkDigit,mode] = [...this.parameters()];
    let type = ZPLSymbolTypeBEBU;
    let opt = {...{type,orientation,height,line,lineAbove,checkDigit,mode}};
    config.set("symbol_options",opt);
    return this.ok()
  }
  static renderFake(context,origin,map,symbolOptions,text){
    let mod_width = map.get("module_width") || 2;
    let height = symbolOptions.height || map.get("height") || 10;
    let x = origin[0];
    const y = origin[1];
    let RLE = createBarcodePattern({text: text, type: "EAN"});
    for(let i = 0; i < RLE.length; i += 2){
      context.fillRect(x,y,mod_width * RLE[i],height);
      x += (mod_width * RLE[i] + mod_width * RLE[i+1]);
    }
    // absolute width is always 95 * mod_width
    return [95 * mod_width, height]
  }
}
class ZPLSymbolTypeBC extends ZPLSymbolTypeCommand{
  constructor(str,type,container){
    super(str,type,container);
    this.requireParams(0,6);
  }
  draw(_,config){
    let [orientation,height,line,lineAbove,checkDigit,mode] = [...this.parameters()];
    let type = ZPLSymbolTypeBC;
    let opt = {...{type,orientation,height,line,lineAbove,checkDigit,mode}};
    config.set("symbol_options",opt);
    return this.ok()
  }
  static renderFake(context,origin,map,symbolOptions,text){
    let mod_width = map.get("module_width") || 2;
    let mod_ratio = map.get("module_ratio") || 3;
    let height = symbolOptions.height || map.get("height") || 10;
    let x = origin[0];
    const y = origin[1];
    let thing = createBarcodePattern({text:text, type: "Code128"});
    for(let code of thing){
      if(!code){
        continue
      }
      for(let i = 0; i < code.length; i += 2){
        context.fillRect(x,y,mod_width * code[i],height);
        x += mod_width * code[i+1] + mod_width * code[i];
        if(code.length > 6 && i === 4){
          context.fillRect(x,y,mod_width * code[6],height);
          x += mod_width * code[6];
          break
        }
      }
    }
    return [x - origin[0],height];
  }
}
class ZPLSymbolTypeBQ extends ZPLSymbolTypeCommand{
  constructor(str,type,container){
    super(str,type,container);
    this.requireParams(0,5);
  }
  draw(_,config){
    let [orientation,model,magnification,ecc,mask] = [...this.parameters()];
    let type = ZPLSymbolTypeBQ;
    let opt = {...{type,orientation,model,magnification,ecc,mask}};
    config.set("symbol_options",opt);
    return this.ok()
  }
  static renderFake(context,origin,map,symbolOptions,text){
    let height = symbolOptions.height || map.get("height") || 10;
    context.fillRect(origin[0],origin[1],height,height);
    return [height,height]
  }
}
class ZPLSymbolTypeBX extends ZPLSymbolTypeCommand{
  constructor(str,type,container){
    super(str,type,container);
    this.requireParams(0,8);
  }
  draw(_,config){
    let [orientation,height,quality,columns,rows,format,escape,ratio] = [...this.parameters()];
    let type = ZPLSymbolTypeBX;
    let opt = {...{type,orientation,height,quality,columns,rows,format,escape,ratio}};
    config.set("symbol_options",opt);
    return this.ok()
  }
  static computeSizeInModules(n){ // inaccurate, but good enough
    let tMaxData = [3,5,8,12,18,22,30,36,44];
    let matrix = 8;
    for (let i = 0; i < tMaxData.length;i++){
      if (n <= tMaxData[i]){
        matrix = 8 + i*2;
        break;
      }
    }
    return matrix + 2;
  }
  static renderFake(context,origin,map,symbolOptions,text){
    let moduleSize = symbolOptions.height;
    let requiredResolution = this.computeSizeInModules(text.length);
    const rows = symbolOptions.rows || requiredResolution;
    if(!moduleSize){
      let size = map.get("height") || 10;
      moduleSize = Math.max(1,Math.floor(size / rows));
    }
    const sideLength = moduleSize * rows;
    context.fillRect(origin[0],origin[1],moduleSize,moduleSize * rows);
    context.fillRect(origin[0] + moduleSize,origin[1] + sideLength, sideLength - moduleSize, -moduleSize);
    for(let x = rows - 1; x > 1; x -= 2){
      context.fillRect(origin[0] + x * moduleSize,origin[1],-moduleSize,moduleSize);
      context.fillRect(origin[0] + sideLength,origin[1] + (x-1) * moduleSize,-moduleSize,-moduleSize);
    }
    return [sideLength,sideLength]
  }
}
class ZPLFontCommand extends ZPLCommand{
  constructor(str,type){
    super(str.trimEnd(),type);
  }
  draw(context,config){
    let [fontName,height,width] = [...this.parameters()];
    let rotation = "N";
    if(this.type === "A" && typeof fontName === "string"){
      rotation = /[BINR]/.test(fontName[1]) ? fontName[1] : "N";
      fontName = /\d/.test(fontName[0]) ? Number.parseInt(fontName[0]) : fontName[0];
    }
    let fontEffects = ZPLFontCommand.getVariant(fontName);
    context.font = `normal ${height}px ${fontEffects[0]}`;
    context.fontStretch = fontEffects[1];
    config.set("text_transform",rotation);
    return this.ok()
  }
  static getVariant(param){
    switch(param){
      case 0:
        return ["Helvetica","ultra-condensed"]
      case "A":
        return ["monospace","normal"]
      default:
        return ["monospace","normal"]
    }
  }
}
class ZPLModuleSizeCommand extends ZPLCommand{
  constructor(str,type){
    super(str.trimEnd(),type);
  }
  draw(_,config){
    let [module_width,module_ratio,height] = [...this.parameters()];
    if(module_width){
      config.set("module_width",module_width);
    }
    if(module_ratio){
      config.set("module_ratio",module_ratio);
    }
    if(height){
      config.set("height",height);
    }
    return this.ok()
  }
}
// Shape commands
class ZPLShapeCommand extends ZPLCommand{
  constructor(str,type){
    super(str.trimEnd(),type);
  }
  static create(str,type){
    if(type === "GB"){
      return new ZPLShapeGB(str,"GB")
    }
    return new ZPLShapeCommand(str,type)
  }
}
class ZPLShapeGB extends ZPLShapeCommand{
  constructor(str,type){
    super(str,type);
    this.requireParams(2,5)
  }
  draw(context,config,origin){
    context.beginPath();
    let [w,h,thickness,color,rounding] = [...this.parameters()];
    let osw = context.lineWidth;
    const sw = Number.parseInt(thickness) || osw;
    let height = Number.parseInt(h);
    let width = Number.parseInt(w);
    if(sw < (height / 2) || sw < (width < 2)){
      let half = sw >> 1;
      context.rect(
        origin[0] + half,
        origin[1] + half,
        width - sw,
        height - sw
      );
      context.stroke();
    }else{
      context.fillRect(origin[0],origin[1],width,height)
    }
    return this.ok()
  }
}
class ZPLCommentCommand extends ZPLCommand{
  constructor(str,type){
    super(str.trimEnd(),type);
  }
  parameters(){
    return ZPLCommand.iterateOnce(this)
  }
}
class ZPLPrintQuantityCommand extends ZPLCommand{
  constructor(str,type){
    super(str.trimEnd(),type);
  }
  get templateContent(){
    return this.hasTemplate ? { type: "number", id: this.text.match(/\$\{(.+)\}/)?.[1], value: undefined } : null
  }
  stringify(template){
    return `^PQ${template.get(this.text) || "1"}`
  }
}
class ZPLPrintOrientCommand extends ZPLCommand{
  constructor(str,type){
    super(str.trimEnd(),type);
    this.requireParams(1,1);
    let param = str.trim().slice(2);
    if(!(param === "N" || param === "I")){
      throw new Error(`invalid parameter in "^PO" command - expected either "I" or "N - found: ${str}"`)
    }
  }
}
class ZPLPrintWidthCommand extends ZPLCommand{
  constructor(str,type){
    super(str.trimEnd(),type);
    this.requireParams(1,1);
    let param = str.trim().slice(2);
    if(!/^\d+$/.test(param)){
      throw new Error(`invalid parameter in "^PW" command - expected number - found ${param}`)
    }
  }
  get templateContent(){
    return this.hasTemplate ? { type: "number", id: this.text.match(/\$\{(.+)\}/)?.[1], value: undefined } : null
  }
}
function FieldRequiredError(type){
  return new Error(`Command ^${type} is invalid outside of a ^FO field`)
}
function FieldInvalidError(type){
  return new Error(`Command ^{type} cannot be used inside a ^FO field`)
}

class Expression{
  constructor(templateField,fun,comp){
    this.target = templateField;
    this.fun = fun;
    this.comp = comp;
  }
  isMatch(obj){
    return this.fun(obj,this.target,this.comp)
  }
  static fromSource(str){
    let [lhs,rhs] = str.split("=").map(a => a.trim());
    if(lhs === "true"){
      return new Expression(null,Expression.always,null)
    }
    if(lhs === "false"){
      return new Expression(null,Expression.never,null)
    }
    if(lhs.startsWith("@")){
      if(rhs){
        return new Expression(lhs.slice(1),Expression.equals,rhs)
      }
      return new Expression(lhs.slice(1),Expression.isAny,null)
    }
    if(lhs.startsWith("!")){
      return new Expression(lhs.slice(1),Expression.isNone,null)
    }
    console.warn(`Expression ${str} couldn't be parsed`);
    return new Expression(null,Expression.always,null)
  }
  static isAny(o,comp){
    return o[comp] !== undefined
  }
  static isNone(o,comp){
    return o[comp] === null || o[comp] === undefined
  }
  static equals(o,comp,test){
    return o[comp] === test
  }
  static never(){
    return false
  }
  static always(){
    return true
  }
}

class CommandRange{
  constructor(start,end,command){
    let s = Number.parseInt(start);
    let e = Number.parseInt(end);
    if(s > e){
      throw new Error("Invalid range");
    }
    let [name,expression] = command.split(",");
    this.start = s;
    this.end =  e;
    this.conditionalExpression = expression ? Expression.fromSource(expression) : null;
    this.name = name;
  }
  testCondition(obj){
    if(this.conditionalExpression){
      return this.conditionalExpression.isMatch(obj)
    }
    return true
  }
}

export class ZPLLabel{
  #isValid;
  #configuration;
  #bitmaps;
  #autoranges;
  #globalOffsets;
  constructor(){
    this.#isValid = false;
    this.commands = [];
    this.#configuration = new Map();
    this.sections = new Map();
    this.#autoranges = null;
    this.#globalOffsets = Int16Array.of(0,0,0);
  }
  setGlobalOffset(x,y,z){
    this.#globalOffsets[0] = x ?? this.#globalOffsets[0];
    this.#globalOffsets[1] = y ?? this.#globalOffsets[1];
    this.#globalOffsets[2] = z ?? this.#globalOffsets[2];
  }
  getGlobalOffset(){
    return {x: this.#globalOffsets[0], y: this.#globalOffsets[1], z: this.#globalOffsets[2]}
  }
  isValid(){
    return this.#isValid
  }
  get templateFields(){
    return Object.fromEntries(
      this.commands
      .filter(c => c.hasTemplate)
      .map(c => c.templateContent)
      .flat()
      .map(a => [a.id,a]))
  }
  get bitmaps(){
    if(!this.#bitmaps){
      this.#bitmaps = new Map();
    }
    return this.#bitmaps
  }
  addCommand(str,type){
    if(str instanceof ZPLCommand){
      this.commands.push(str)
    }else if(str.trim().length){
      this.commands.push(new ZPLUnknownCommand(str,type));
    }
  }
  #setupRender(config){
    for(let hmm of Object.entries(config)){
      if(hmm[1] !== undefined){
        if(hmm[1] instanceof ZPLImageBitmap){
          let hash = hmm[1].hash;
          this.#configuration.set(`\$\{${hmm[0]}\}`,hash);
          this.#configuration.set(hash,this.bitmaps.get(hash))
        }else{
          this.#configuration.set(`\$\{${hmm[0]}\}`,String(hmm[1]))
        }
      }
    }
  }
  #constructAutoRanges(){
    // sections is iterated in insertion order so it's already sorted
    let i = 0;
    let arr = [];
    for(let range of this.sections.values()){
      if(i < range.start){
        arr.push(new CommandRange(i,range.start,"<root>"))
      }
      arr.push(range);
      i = range.end;
    }
    if(i < this.commands.length){
      arr.push(new CommandRange(i,this.commands.length,"<root>"))
    }
    this.#autoranges = arr
  }
  get autoRanges(){
    if(!this.#autoranges){
      this.#constructAutoRanges();
    }
    return this.#autoranges
  }
  render(context,template = {}){
    if(this.sections.size > 0){
      let ranges = this.autoRanges.filter(r => r.testCondition(template));
      return this.renderRanges(context,ranges,template)
    }
    this.#setupRender(template);
    let results = ZPLLabel.#renderCommandSlice(context,this.commands,this.#configuration,this.#globalOffsets);
    
    this.#configuration.clear();
    return results;
  }
  renderRanges(context,ranges,template = {}){
    if(!ranges.every(r => r.start < r.end)){
      throw new Error("Invlid ranges")
    }
    this.#setupRender(template);
    let results = ranges.map(range => ZPLLabel.#renderCommandSlice(context,this.commands.slice(range.start,range.end),this.#configuration,this.#globalOffsets));
    this.#configuration.clear();
    return results.flat();
  }
  static #renderCommandSlice(context,slice,config,globalOffsets){
    let results = slice.map(command => {
      try{
        if(command instanceof ZPLField){
          return command.draw(context,config,globalOffsets)
        }
        return command.draw(context,config)
      }catch(ex){
        console.error(ex);
        return command.toError(ex.message)
      }
    });
    return results.flat();
  }
  #setupConfiguration(config){
    if(!this.#isValid){
      throw new Error("Invalid label can't be stringified")
    }
    for(let hmm of Object.entries(config)){
      if(hmm[1] != undefined){
        this.#configuration.set(`\$\{${hmm[0]}\}`,hmm[1] instanceof ZPLImageBitmap ? hmm[1].string : String(hmm[1]))
      }
    }
  }
  stringify(template = {}){
    if(this.sections.size > 0){
      let ranges = this.autoRanges.filter(r => r.testCondition(template));
      return this.stringifyRanges(ranges,template)
    }
    this.#setupConfiguration(template);
    const str =  `^XA
${this.commands.map(c => c.stringify(this.#configuration,this.#globalOffsets)).join("\n")}
^XZ`;
    this.#configuration.clear();
    return str
  }
  stringifyRanges(ranges,template = {}){
    if(!ranges.every(r => r.start <= r.end)){
      throw new Error("Invlid ranges")
    }
    this.#setupConfiguration(template);
    let str = "^XA";
    
    let parts = ranges
    .map(range => this.commands.slice(range.start,range.end)
              .map(command => command.stringify(this.#configuration,this.#globalOffsets))
              .join("\n"));
    this.#configuration.clear();
    return "^XA"+parts.join("\n")+"^XZ"
  }
  static async parse(str){
    let label = new ZPLLabel();
    if(str.length && str[0] != "^"){
      throw new Error(`Invalid data at [0]: ${str.slice(0,3)}`)
    }
    let s = 0;
    let head = 0;
    let commands = [];
    while(head < str.length){
      if(head > 0 && str[head] === "^"){
        if(head < s+2){
          throw new Error(`Invalid command start marker "^" at: ${str.slice(s,head+3)}`)
        }
        commands.push(str.slice(s+1,head))
        s = head
      }
      head++
    }
    if(s < str.length){
      commands.push(str.slice(s+1));
      if(commands.at(-1).length === 0){
        throw new Error(`Leftover command start marker "^" at: ${s}`)
      }
    }
    let rangeName = null;
    let sectionStartAt = 0;
    let container = null;
    for(let command of commands){
      if(command[0] === "A"){
        if(!container){
          throw FieldRequiredError("Ax")
        }
        container.addCommand(new ZPLFontCommand(command,"A"));
        continue
      }
      let cmd = command.slice(0,2);
      switch(cmd){
        case "FX": // comment
          container
            ? container.addCommand(new ZPLCommentCommand(command,cmd))
            : label.addCommand(new ZPLCommentCommand(command,cmd));
          break;
        case "BC": // Code128
        case "BE": // EAN
        case "BO": // Aztec
        case "BQ": // QR
        case "BU": // UPC
        case "BX": // Datamatrix
          if(!container){
            throw FieldRequiredError(cmd)
          }
          container.addCommand(ZPLSymbolTypeCommand.create(command,cmd))
          break;
        case "BY": // configure module size, applies to all subsequent codes
          container
            ? container.addCommand(new ZPLModuleSizeCommand(command,cmd))
            : label.addCommand(new ZPLModuleSizeCommand(command,cmd));
            break;
        case "CF": // specify global font outside that applies if fields doesn't set one
          container
            ? container.addCommand(new ZPLFontCommand(command,cmd))
            : label.addCommand(new ZPLFontCommand(command,cmd));
          break;
        case "FO":
          if(container){
            throw FieldInvalidError("FO")
          }
          container = new ZPLField(command,"FO");
          break
        case "FS":
          if(!container){
            throw FieldRequiredError("FS")
          }
          label.addCommand(ZPLField.close(container));
          container = null
          break
        case "FR": // invert field color
        case "FB": // set field writing mode to block instead of inline
          if(!container){
            throw FieldRequiredError("FR")
          }
          container.addCommand(new ZPLFieldModifierCommand(command,cmd));
          break
        case "FD": // Sets field data
          if(!container){
            throw FieldRequiredError("FD")
          }
          container.addCommand(new ZPLFieldDataCommand(command,cmd));
          break
        case "GB": // basic shape box
        case "GC": // basic shape circle
        case "GD": // basic shape diagonal line
        case "GE": // basic shape ellipse
          if(!container){
            throw FieldRequiredError(cmd)
          }
          container.addCommand(ZPLShapeCommand.create(command,cmd));
          break
        case "GF": {
          if(!container){
            throw FieldRequiredError("GF")
          }
          let gfCommand = new ZPLGraphicsFieldCommand(command,cmd);
          if(!gfCommand.hasTemplate){
            let specs = ZPLGraphicsFieldCommand.parseImageDefinition(gfCommand.text);
            let imageData = ZPLGraphicsFieldCommand.stringToImageData(specs);
            let imageBitmap = await createImageBitmap(imageData);
            label.bitmaps.set(gfCommand.hash,imageBitmap)
          }
          container.addCommand(gfCommand);
          break
        }
        case "PO":
          if(container){
            throw FieldInvalidError("PO")
          }
          label.addCommand(new ZPLPrintOrientCommand(command,cmd));
          break;
        case "PQ":
          if(container){
            throw FieldInvalidError("PQ")
          }
          label.addCommand(new ZPLPrintQuantityCommand(command,cmd));
          break;
        case "PW":
          if(container){
            throw FieldInvalidError("PO")
          }
          label.addCommand(new ZPLPrintWidthCommand(command,cmd));
          break;
        case "SN":
          if(!container){
            throw FieldRequiredError("SN")
          }
          container.addCommand(new ZPLFieldSerialDataCommand(command,cmd));
          break;
        case "--": // This is a custom "command" that can be used to split command stream into sections
          if(container){
            throw new Error("Section separators are only supported at top level")
          }
          if(rangeName){
            let range = new CommandRange(sectionStartAt,label.commands.length,rangeName);
            label.sections.set(range.name,range);
          }
          rangeName = command.slice(2).trim() || null;
          if(rangeName){
            sectionStartAt = label.commands.length;
          }
          break;
        default:
          container
            ? container.addCommand(command,cmd)
            : label.addCommand(command,cmd);
      }
    }
    label.#isValid = true;
    // auto-close range if one exists
    if(rangeName){
      let range = new CommandRange(sectionStartAt,label.commands.length,rangeName);
      label.sections.set(range.name,range);
    }
    return label
  }
}

export class ZPLStream{
  #isValid;
  constructor(name){
    this.name = name;
    this.labels = [];
  }
  isValid(){
    return this.labels.length > 0 && this.labels.every(a => a.isValid());
  }
}

export class ZPLImageBitmap{
  #hash;
  #size;
  #bitmap;
  constructor(def = {}){
    this.#bitmap = def.bitmap;
    this.string = def.string;
    return Object.freeze(this)
  }
  get size(){
    if(!this.#size){
      this.#size = ZPLGraphicsFieldCommand.parseImageDefinition(this.string);
    }
    return this.#size
  }
  forget(){
    this.#bitmap && this.#bitmap.close();
    this.#bitmap = null
  }
  async getBitmap(){
    if(!this.#bitmap){
      let imageData = ZPLGraphicsFieldCommand.stringToImageData(this.size);
      this.#bitmap = await createImageBitmap(imageData);
    }
    return this.#bitmap
  }
  get hash(){
    if(!this.#hash){
      this.#hash = ZPLGraphicsFieldCommand.computeImageHash(this.string)
    }
    return this.#hash
  }
}

export class ZPLParser{
  static async parse(str){
    let stream = new ZPLStream();
    let labels = str.matchAll(/\^XA\s*(.*)\s*\^XZ/gs);
    let s = await Promise.all(labels.map(label => ZPLLabel.parse(label[1])));
    s.forEach(p => stream.labels.push(p))
    return stream
  }
  static async bytesToImageData(aBytes){
    let bytes = new Uint8ClampedArray(aBytes.buffer);
    let base = btoa(Array.from(bytes).map(b => String.fromCharCode(b)).join(''));
    let img = new Image();
    img.src = `data:image/png;base64,${base}`;
    await new Promise(res => { img.addEventListener("load",res,{once:true}) });
    let osc = new OffscreenCanvas(img.naturalWidth,img.naturalHeight);
    let ctx = osc.getContext("2d");
    ctx.drawImage(img,0,0);
    let im = ctx.getImageData(0,0,img.naturalWidth,img.naturalHeight);
    return im
  }
  static serializeImage(aImg){
    const { data, height, width } = aImg;
    let pix = new Array(height * width);
    for(let i = 0; i < pix.length; i++){
      if(data[i * 4 + 3] < 127){// 50% alpha
        pix[i] = 0;
        continue
      }
      let r = data[i * 4];
      let g = data[i * 4 + 1];
      let b = data[i * 4 + 2];
      
      let luma = (Math.max(r,g,b) + Math.min(r,g,b)) / 2;
      pix[i] = luma < 70 ? 1 : 0; 
    }
    let fullBytes = width >> 3;
    let padBits = width % 8;
    let rowWidth = fullBytes + (padBits ? 1 : 0);
    let out = new Array(rowWidth * height);
    for(let i = 0; i < height; i++){
      for(let j = 0; j < fullBytes; j++){
        let offset = i * width + (j * 8);
        out[i*rowWidth+j] = (pix[offset] << 7)
                          | (pix[offset+1] << 6)
                          | (pix[offset+2] << 5)
                          | (pix[offset+3] << 4)
                          | (pix[offset+4] << 3)
                          | (pix[offset+5] << 2)
                          | (pix[offset+6] << 1)
                          | (pix[offset+7])
      }
      if(padBits){
        let remainder = 0;
        let offset = i * width + (fullBytes * 8);
        for(let j = 0; j < padBits;j++){
          remainder |= pix[offset+j] << (7 - j);
        }
        out[i*rowWidth+fullBytes] = remainder;
        if(padBits < 5){
          out[i*rowWidth+fullBytes+1] = 0
        }
      }
    }
    let lines = new Array(height);
    for(let i = 0; i < height; i++){
      let j = rowWidth;
      lines[i] = out.slice(i*rowWidth,(i+1)*rowWidth);
      while(--j >= 0){
        if(out[i*rowWidth+j] > 0){
          break
        }
        lines[i].pop();
      }
      if(lines[i].length < rowWidth){
        lines[i].push(-1)
      }
    }
    return lines.map(o => o.map(b => b < 0 ? "," : (b >> 4).toString(16) + (b & 0xf).toString(16)).join(""))
                .map((line,i,a) => a[i-1] === line ? ":" : line)
                .join("")
  }
  static async convertImage(aBytes){
    let imageData = await ZPLParser.bytesToImageData(aBytes);
    let len = (imageData.height * ((imageData.width >> 3) + (imageData.width % 8 > 0 ? 1 : 0)));
    let data = ZPLParser.serializeImage(imageData);
    return new ZPLImageBitmap({
      string: `A,${len},${len},${len / imageData.height},${data}`
    })
  }
}