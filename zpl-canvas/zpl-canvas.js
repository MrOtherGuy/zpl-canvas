import { ZPLParser, ZPLStream, ZPLLabel } from "./zpl-parser.js";
export { ZPLParser, ZPLStream, ZPLLabel }

function createElement(tag,props){
  let node = document.createElement(tag);
  for(let [key,val] of Object.entries(props)){
    node.setAttribute(key,val)
  }
  return node
}

export class ZPLCanvas extends HTMLElement{
  #canvas;
  #ctx;
  #scaleFactor;
  #label;
  #templateForm;
  constructor(){
    super();
    let template = document.getElementById("table-view-template");
    let fragment = template ? template.content.cloneNode(true) : ZPLCanvas.Fragment();
    let shadowRoot = this.attachShadow({mode: "open"}).appendChild(fragment);
    this.#scaleFactor = 1;
  }
  #doConnectedCallback(){
    let width = this.getAttribute("data-width");
    let height = this.getAttribute("data-height");
    let scale = this.getAttribute("data-scale");
    if(scale){
      let f = Number.parseFloat(scale);
      this.#scaleFactor = f;
    }
    if(width && height){
      this.setSize(width,height)
    }
    let childNodeText = Array.from(this.childNodes).filter(a => a.localName === "template").map(a => a.content.textContent).join("\n");
    if(childNodeText.length){
      requestAnimationFrame(()=>this.renderText(childNodeText))
    }else{
      this.canvasContext;
    }
  }
  connectedCallback(){
    if(document.readyState === "complete"){
      this.#doConnectedCallback()
    }else{
      document.addEventListener("DOMContentLoaded",()=>this.#doConnectedCallback(),{once:true})
    }
  }
  setSize(width,height){
    let scaledW = Math.floor(Math.max(0,Math.min(this.#scaleFactor * width,2048)));
    let scaledH = Math.floor(Math.max(0,Math.min(this.#scaleFactor * height,2048)));
    this.canvas.setAttribute("width",scaledW);
    this.canvas.setAttribute("height",scaledH);
    this.canvasContext.scale(this.#scaleFactor,this.#scaleFactor);
    // you need to manually call .render() after this, if size changes then you likely
    // don't want to render existing label anyway
  }
  stringify(template = {}){
    if(!(typeof template === "object") && !Array.isArray(template)){
      throw new Error("template descriptor is not an object")
    }
    let templateParams = ZPLCanvas.#convertTemplateToInput(this.templateParams,template);
    return this.label.stringify(templateParams)
  }
  get canvas(){
    if(!this.#canvas){
      this.#canvas = this.shadowRoot.querySelector("canvas");
    }
    return this.#canvas
  }
  get canvasContext(){
    if(!this.#ctx){
      this.#ctx = this.canvas.getContext("2d");
      this.#ctx.imageSmoothingEnabled = false;
    }
    return this.#ctx
  }
  setScale(x){
    let oldScale = this.#scaleFactor;
    this.#scaleFactor = x;
    
    this.setSize(this.canvas.width / oldScale,this.canvas.height / oldScale); 
    this.#label && this.render()
  }
  get label(){
    return this.#label;
  }
  set label(zpl){
    if(zpl instanceof ZPLLabel || zpl === null){
      this.#label = zpl;
      zpl && this.render();
    }else{
      throw new Error("label can only be set to ZPLLabel instance or null")
    }
  }
  get templateAttributes(){
    let ents = Object.entries(this.dataset).filter(a => a[0].startsWith("template_"));
    return Object.fromEntries(ents.map(a => [a[0].slice(9),{id: a[0].slice(9), value: a[1],type:"text"}]));
  }
  get templateParams(){
    if(this.label?.isValid()){
      let things = Object.assign(this.label.templateFields,this.templateAttributes);
      let formItems = Array.from(this.templateForm.children);
      for(let [key,val] of Object.entries(things)){
        let match = formItems.find(a => a.dataset.key === key);
        if(match && match.value){
          val.value = match.value;
        }
      }
      return things
    }
    return this.templateAttributes
  }
  set templateParams(obj){
    if(obj && !(typeof obj === "object" && !Array.isArray(obj))){
      throw new Error("template descritor is not an object")
    }
    {
      let attrs = [];
      for(let attr of this.attributes){
        if(attr.name.startsWith("data-template_")){
          attrs.push(attr.name)
        }
      }
      attrs.forEach(a => this.removeAttribute(a));
    }
    if(!obj){
      return
    }
    for(let ent of Object.entries(obj)){
      this.dataset[`template_${ent[0]}`] = ent[1]
    }
  }
  get templateForm(){
    return this.#templateForm
  }
  render(aZpl = null,template = {}){
    const zpl = aZpl === null ? this.label : aZpl; 
    if(!(zpl instanceof ZPLLabel)){
      throw new Error("not a valid ZPLLabel")
    }
    if(!(typeof template === "object") && !Array.isArray(template)){
      throw new Error("template descriptor is not an object")
    }
    const canvas = this.canvas;
    this.canvasContext.clearRect(0,0,this.canvas.width * (1/this.#scaleFactor),this.canvas.height * (1/this.#scaleFactor));
    // a zpl stream can contain more than one label, we only render the first one
    if(!zpl.isValid()){
      throw new Error("ZPL stream doesn't contain any labels, maybe missing ^XA or ^XZ ?")
    }
    this.#label = zpl;

    let templateParams = ZPLCanvas.#convertTemplateToInput(this.templateParams,template);
    let result = zpl.render(this.canvasContext,templateParams);
    
    return result
  }
  static #convertTemplateToInput(obj,input){
    let out = {};
    for(let val of Object.values(obj)){
      out[val.id] = val.value
    }
    return Object.assign(out,input)
  }
  renderText(str,template = {}){
    let thing = ZPLParser.parse(str);
    if(!thing.isValid()){
      throw new Error("ZPL stream doesn't contain any labels, maybe missing ^XA or ^XZ ?")
    }
    if(this.dataset.form === "true"){
      let templateParams = Object.assign(thing.labels[0].templateFields,this.templateAttributes)
      this.updateTemplateForm(templateParams);
    }
    return this.render(thing.labels[0],template);
    // do things
  }
  updateTemplateForm(params){
    let form = this.templateForm || ZPLCanvas.makeTemplateForm(this);
    let formItems = Array.from(form.children);
    let toBePreserved = new Set();
    let frag = new DocumentFragment();
    for(let [key,val] of Object.entries(params)){
      let item = formItems.find(a => a.dataset.key === key);
      if(!item){
        let tr = ZPLCanvas.formRowFragment(this,val.type);
        tr.key = key;
        frag.appendChild(tr);
        toBePreserved.add(tr);
      }else{
        toBePreserved.add(item)
      }
    }
    for(let child of formItems){
      if(!toBePreserved.has(child)){
        child.input.removeEventListener("input",this);
        child.input.removeEventListener("change",this);
        delete child.input._file
        child.remove()
      }
    }
    toBePreserved.clear();
    form.append(frag);
  }
  handleEvent(ev){
    if(ev.target.dataset.type !== "form-input"){
      return
    }
    if(ev.type === "input"){
      this.render()
    }else if(ev.type === "change" && ev.target.type === "file"){
      let file = ev.target.files[0];
      if(!file){
        ev.target._file = null;
        this.render();
        return
      }
      let target = ev.target;
      target.files[0].bytes()
      .then(ZPLCanvas.bytesToImageData)
      .then(imageData => {
        let data = ZPLCanvas.serializeImage(imageData);
        let len = (imageData.height * imageData.width) / 8;
        target._file = `A,${len},${len},${imageData.width / 8},${data}`;
        this.render()
      })
    }
  }
  static serializeImage(aImg){
    const { data, height, width } = aImg;
    let pix = new Array(height * width);
    for(let i = 0; i < pix.length; i++){
      let r = data[i * 4];
      let g = data[i * 4 + 1];
      let b = data[i * 4 + 2];
      let a = data[i * 4 + 3] / 255;
      let luma = ((Math.max(r,g,b) + Math.min(r,g,b)) / 2) * a;
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
        for(let j = 0; j < padBits;i++){
          remainder |= pix[offset+j] << (7 - j);
        }
        out[i*rowWidth+fullBytes] = remainder
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
  static makeTemplateForm(zplcanvas){
    let box = zplcanvas.shadowRoot.appendChild(createElement("div",{class:"form-container",part:"form-box"}));
    let table = box.appendChild(createElement("table",{id:"template-form",part:"form"}));
    zplcanvas.#templateForm = table.createTBody();
    return zplcanvas.#templateForm 
  }
  static makeFragment(){
    let frag = document.createDocumentFragment();
    frag.appendChild(createElement("link",{as:"style",type:"text/css",rel:"preload prefetch stylesheet",href:"./zpl-canvas/zpl-canvas.css"}));
    let div = frag.appendChild(createElement("div",{class:"canvas-bg",part:"canvas-bg"}));
    let canvas = div.appendChild(createElement("canvas",{part:"canvas"}));
    return frag
  }
  static #Fragment;
  static Fragment(){
    if(!ZPLCanvas.#Fragment){
      ZPLCanvas.#Fragment = ZPLCanvas.makeFragment()
    }
    return ZPLCanvas.#Fragment.cloneNode(true)
  }
  static initFormRowItem(item,zpl,inputType){
    Object.defineProperties(item,{
      key: {
        get(){
          return this.dataset.key
        },
        set(k){
          this.dataset.key = k;
          this.cells[0].textContent = k;
        }
      },
      input:{
        get(){
          return this.cells[1].firstChild
        }
      }
    });
    if(inputType === "image"){
      let input = item.cells[1].firstChild;
      Object.defineProperty(item,"value",{
        get(){
          return this.input._file
        }
      });
      input.setAttribute("type","file");
      input.setAttribute("accept","image/png");
      input._file = null;
      input.addEventListener("change",zpl);
    }else{
      Object.defineProperty(item,"value",{
        get(){
          return this.input.value
        }
      })
      if(inputType ==="number"){
        let input = item.cells[1].firstChild;
        input.setAttribute("type","number");
        input.setAttribute("min","1");
        input.setAttribute("max","500");
        input.setAttribute("placeholder","1");
      }
      item.input.addEventListener("input",zpl);
    }
    
    return item
  }
  static #formRowFragment;
  static formRowFragment(zpl,inputType){
    if(!this.#formRowFragment){
      let frag = document.createDocumentFragment();
      let tr = createElement("tr",{class: "templatelist-item"});
      tr.appendChild(createElement("td",{class: "templatelist-label"}));
      let cell = tr.appendChild(createElement("td",{class: "templatelist-value"}));
      let input = cell.appendChild(createElement("input",{type:"text",placeholder: "template value","data-type": "form-input"}));
      frag.appendChild(tr);
      this.#formRowFragment = frag
    }
    return this.initFormRowItem(this.#formRowFragment.firstChild.cloneNode(true),zpl,inputType)
  }
}

customElements.define("zpl-canvas",ZPLCanvas);
