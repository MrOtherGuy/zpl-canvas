class ZPLCommand{
  constructor(str,type){
    this.text = str.slice(type.length);
    this.type = type;
    if(!(type === "A" || type.length === 2)){
      throw new Error(`invalid command - must be either "A" or 2 characters - found "^${this.type}"`)
    }
  }
  parameters(){
    const arr = this.text.split(/\s*,\s*/).map(a => {let n = Number.parseInt(a); return Number.isNaN(n) ? a : n});
    return arr.values()
  }
  requireParams(min,max = 10){
    let count = this.text.split(/\s*,\s*/).length;
    if(count < min || count > max){
      throw new Error(`invalid parameter count in "^${this.type}${this.text}"`)
    }
  }
  draw(){
    console.log(this.type,this.text)
    return this.toError("unknown command")
  }
  toError(msg){
    return { command: `^${this.type}${this.text}`, ok: false, reason: msg }
  }
  toSuccess(){
    return { command: `^${this.type}${this.text}`, ok: true }
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
class ZPLField extends ZPLCommand{
  #commands;
  constructor(str){
    super(str,"FO");
    let params = [...this.parameters()];
    if(params.length < 2 || params.length > 3 || !params.every(a => (typeof a === "number"))){
      throw new Error(`invalid ^FO command: "${str}"`);
    }
    this.#commands = [];
  }
  draw(context,config){
    context.textBaseline = "top";
    let composite = context.globalCompositeOperation;
    let fd = null;
    let fontStyle = context.font;
    let fieldSpecificFont = null;
    const isTextField = this.isTextField();
    const params = [...this.parameters()];
    
    let results = this.#commands
    .map((command,idx) => {
      if(command instanceof ZPLFieldDataCommand){
        fd = {index: idx, cmd:command}
        return {dummy:true}
      }else if(command.type === "CF"){
        // CF inside a field modifies the global font but does not affect text inside field that is configured as barcode - it does affect pure text fields though
        let font = context.font;
        let result = command.draw(context,config,params);
        fontStyle = context.font;
        if(!isTextField){
          context.font = font
        }
        return result
      }
      let result = command.draw(context,config,params);
      if(command.type === "A"){
        fieldSpecificFont = context.font
      }
      return result
    });
    
    if(!isTextField && !fieldSpecificFont){
      context.font = "normal 36px monospace";
    }
    if(fd){
      results[fd.index] = fd.cmd.draw(context,config,params);
    }
    context.font = fontStyle;
    context.globalCompositeOperation = composite;
    config.delete("symbol_type");
    config.delete("orientation");
    config.delete("symbol_height");
    config.delete("line");
    config.delete("lineAbove");
    config.delete("checkDigit");
    config.delete("mode");
    results.unshift(this.toSuccess());
    return results
  }
  isTextField(){
    return this.#commands.every(a => !(a instanceof ZPLSymbolTypeCommand))
  }
  addCommand(str,type){
    if(str instanceof ZPLCommand){
      this.#commands.push(str)
    }else if(str.trim().length){
      this.#commands.push(new ZPLCommand(str,type));
    }
  }
}
class ZPLFieldDataCommand extends ZPLCommand{
  constructor(str,type,propMap){
    super(str,type);
  }
  parameters(){
    return ZPLCommand.iterateOnce(this)
  }
  textSize(context){
    return Number.parseInt(context.font.match(/\d+/)) || 20
  }
  toSuccess(){
    return { command: `^${this.type}${[...this.parameters()].join(",")}`, ok: true }
  }
  draw(context,config,origin){
    let symbolType = config.get("symbol_type");
    let y_origin = origin[1];
    let textOrigin = origin[0];
    if(symbolType){
      let size = symbolType.renderFake(context,origin,config);
      if(symbolType != ZPLSymbolTypeBC){
        // we can return since symbol types other than code128 don't print text
        return this.toSuccess()
      }
      y_origin += size[1] + 10;
      textOrigin += (size[0] >> 1);
      context.textAlign = "center";
    }
    if(config.get("line") != "N"){
      context.fillText(this.text,textOrigin,y_origin);
    }
    if(config.get("lineAbove") === "Y"){
      context.fillText(this.text,textOrigin,origin[1] - this.textSize(context));
    }
    context.textAlign = "left";
    return this.toSuccess()
  }
}
class ZPLFieldModifierCommand extends ZPLCommand{
  constructor(str,type){
    super(str,type);
  }
  draw(context,config){
    if(this.type === "FR"){
      context.globalCompositeOperation = "xor";
      return this.toSuccess()
    }
    return this.toSuccess()
  }
}
class ZPLSymbolTypeCommand extends ZPLCommand{
  constructor(str,type,propMap){
    super(str.trimEnd(),type);
    this.requireParams(0,6);
  }
  static create(str,type){
    if(type === "BC"){
      return new ZPLSymbolTypeBC(str)
    }
    if(type === "BQ"){
      return new ZPLSymbolTypeBQ(str)
    }
    if(type === "BX"){
      return new ZPLSymbolTypeBX(str)
    }
    return new ZPLSymbolTypeCommand(str,type)
  }
  static renderFake(){
    console.log("unimplemented fake render");
    return [0,0]
  }
}
class ZPLSymbolTypeBC extends ZPLSymbolTypeCommand{
  constructor(str){
    super(str,"BC");
    this.requireParams(0,6);
  }
  draw(_,config){
    let [orientation,height,line,lineAbove,checkDigit,mode] = [...this.parameters()];
    config
    .set("symbol_type",ZPLSymbolTypeBC)
    .set("orientation",orientation)
    .set("symbol_height",height)
    .set("line",line)
    .set("lineAbove",lineAbove)
    .set("checkDigit",checkDigit)
    .set("mode",mode);
    return this.toSuccess()
  }
  static renderFake(context,origin,map){
    let mod_width = map.get("module_width") || 2;
    let mod_ratio = map.get("module_ratio") || 3;
    let height = map.get("symbol_height") || map.get("height") || 10;
    let x = origin[0];
    const y = origin[1];
    for(let i = 0; i < 10; i++){
      context.fillRect(x,y,mod_width,height);
      x += mod_width+(mod_ratio * mod_width);
      context.fillRect(x,y,mod_width * mod_ratio,height);
      x += mod_width+(mod_ratio * mod_width);
      context.fillRect(x,y,mod_width * 2 * mod_ratio,height);
      x += mod_width+(mod_ratio * 2 * mod_width);
    }
    return [x - origin[0],height];
  }
}
class ZPLSymbolTypeBQ extends ZPLSymbolTypeCommand{
  constructor(str){
    super(str,"BQ");
    this.requireParams(0,5);
  }
  draw(_,config){
    let [orientation,height,line,lineAbove,checkDigit,mode] = [...this.parameters()];
    config
    .set("symbol_type",ZPLSymbolTypeBQ)
    .set("orientation",orientation)
    .set("symbol_height",height)
    .set("line",line)
    .set("lineAbove",lineAbove)
    .set("checkDigit",checkDigit)
    .set("mode",mode);
    return this.toSuccess()
  }
  static renderFake(context,origin,map){
    let height = map.get("symbol_height") || map.get("height") || 10;
    context.fillRect(origin[0],origin[1],height,height);
    return [height,height]
  }
}
class ZPLSymbolTypeBX extends ZPLSymbolTypeCommand{
  constructor(str){
    super(str,"BX");
    this.requireParams(0,7);
  }
  draw(_,config){
    let [orientation,height,line,lineAbove,checkDigit,mode] = [...this.parameters()];
    config
    .set("symbol_type",ZPLSymbolTypeBX)
    .set("orientation",orientation)
    .set("symbol_height",height)
    .set("line",line)
    .set("lineAbove",lineAbove)
    .set("checkDigit",checkDigit)
    .set("mode",mode);
    return this.toSuccess()
  }
  static renderFake(context,origin,map){
    let height = map.get("symbol_height") || map.get("height") || 10;
    context.fillRect(origin[0],origin[1],height,height);
    return [height,height]
  }
}
class ZPLFontCommand extends ZPLCommand{
  constructor(str,type){
    super(str.trimEnd(),type);
  }
  draw(context){
    let [fontName,height,width] = [...this.parameters()];
    let fontEffects = ZPLFontCommand.getVariant(fontName);
    context.font = `normal ${height}px ${fontEffects[0]}`;
    context.fontStretch = fontEffects[1];
    return this.toSuccess()
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
    return this.toSuccess()
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
    return this.toSuccess()
  }
}
class ZPLCommentCommand extends ZPLCommand{
  constructor(str,type){
    super(str.trimEnd(),type);
  }
  draw(){
    return this.toSuccess()
  }
  parameters(){
    return ZPLCommand.iterateOnce(this)
  }
}
export class ZPLLabel{
  #isValid;
  constructor(){
    this.#isValid = false;
    this.commands = [];
    this.configuration = new Map();
  }
  isValid(){
    return this.#isValid
  }
  addCommand(str,type){
    if(str instanceof ZPLCommand){
      this.commands.push(str)
    }else if(str.trim().length){
      this.commands.push(new ZPLCommand(str,type));
    }
  }
  render(context){
    let results = this.commands
    .map(command => {
      try{
        return command.draw(context,this.configuration)
      }catch(ex){
        console.error(ex);
      }
      return command.toError(ex.message)
    });
    this.configuration.clear();
    return results.flat();
  }
  static parse(str){
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
    let container = null;
    for(let command of commands){
      if(command[0] === "A"){
        if(!container){
            throw new Error("Stumbled upon ^Ax but no container")
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
        case "BO": // Aztec
        case "BQ": // QR
        case "BX": // Datamatrix
          if(!container){
            throw new Error(`Command ^${cmd} must be used inside a field (^FO)`)
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
            throw new Error("Stumbled upon ^FO in already open container")
          }
          container = new ZPLField(command);
          break
        case "FS":
          if(!container){
            throw new Error("Stumbled upon ^FS but no container")
          }
          label.addCommand(container,cmd);
          container = null
          break
        case "FR": // invert field color
          if(!container){
            throw new Error("Stumbled upon ^FR but no container")
          }
          container.addCommand(new ZPLFieldModifierCommand(command,cmd));
          break
        case "FD": // Sets field data
          if(!container){
            throw new Error("Stumbled upon ^FD but no container")
          }
          container.addCommand(new ZPLFieldDataCommand(command,cmd));
          break
        case "GB": // basic shape box
        case "GC": // basic shape circle
        case "GD": // basic shape diagonal line
        case "GE": // basic shape ellipse
          container
            ? container.addCommand(ZPLShapeCommand.create(command,cmd))
            : label.addCommand(ZPLShapeCommand.create(command,cmd));
          break
        default:
          container
            ? container.addCommand(command,cmd)
            : label.addCommand(command,cmd);
      }
    }
    label.#isValid = true
    
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

export class ZPLParser{
  static parse(str){
    let stream = new ZPLStream();
    let t = str.matchAll(/\^XA\s*(.*)\s*\^XZ/gs);
    for(let label of t){
      stream.labels.push(ZPLLabel.parse(label[1]))
    }
    return stream
  }
}