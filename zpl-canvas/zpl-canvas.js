import { ZPLParser, ZPLStream, ZPLLabel } from "./zpl-parser.js";
export { ZPLParser, ZPLStream, ZPLLabel }

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
    if(width && height){
      this.setSize(width,height)
    }
    if(scale){
      this.setScale(Number.parseFloat(scale))
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
    this.canvas.setAttribute("width",width);
    this.canvas.setAttribute("height",height);
  }
  stringify(template = {}){
    if(!(typeof template === "object") && !Array.isArray(template)){
      throw new Error("template descriptor is not an object")
    }
    let templateParams = Object.assign(this.templateParams,template);
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
    this.setSize(this.canvas.width * (x / this.#scaleFactor),this.canvas.height * (x / this.#scaleFactor));
    this.#scaleFactor = x;
    this.canvasContext.scale(x,x);
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
    return Object.fromEntries(ents.map(a => [a[0].slice(9),a[1]]));
  }
  get templateParams(){
    if(this.label?.isValid()){
      let things = Object.assign(this.label.templateFields,this.templateAttributes);
      let formItems = Array.from(this.templateForm.children);
      for(let [key,val] of Object.entries(things)){
        let match = formItems.find(a => a.dataset.key === key);
        if(match && match.cells[1].firstChild.value){
          things[key] = match.cells[1].firstChild.value;
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
    let templateParams = Object.assign(this.templateParams,template);
    let result = zpl.render(this.canvasContext,templateParams);
    
    return result
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
    for(let [key,val] of Object.entries(params)){
      let item = formItems.find(a => a.dataset.key === key);
      if(!item){
        let it = ZPLCanvas.#ce("tr",{class: "templatelist-item", "data-key": key});
        it.appendChild(ZPLCanvas.#ce("td",{class: "templatelist-label"})).textContent = key;
        let cell = it.appendChild(ZPLCanvas.#ce("td",{class: "templatelist-value"}));
        let input = cell.appendChild(ZPLCanvas.#ce("input",{type:"text",placeholder: "template value"}));
        input.zpl = this;
        input.addEventListener("input",ZPLCanvas.formFieldListener);
        form.appendChild(it);
        toBePreserved.add(it);
      }else{
        toBePreserved.add(item)
      }
    }
    for(let child of formItems){
      if(!toBePreserved.has(child)){
        child.removeEventListener("input",ZPLCanvas.formFieldListener);
        child.remove()
      }
    }
    toBePreserved.clear()
  }
  static formFieldListener(ev){
    let zpl = ev.target.zpl;
    if(!zpl){
      return
    }
    zpl.render()
  }
  static makeTemplateForm(zplcanvas){
    let box = zplcanvas.shadowRoot.appendChild(ZPLCanvas.#ce("div",{class:"form-container",part:"form-box"}));
    let table = box.appendChild(ZPLCanvas.#ce("table",{id:"template-form",part:"form"}));
    table.appendChild(document.createElement("tbody"));
    zplcanvas.#templateForm = table;
    return table
  }
  static #ce(tag,props){
    let node = document.createElement(tag);
    for(let [key,val] of Object.entries(props)){
      node.setAttribute(key,val)
    }
    return node
  }
  static makeFragment(){
    let frag = document.createDocumentFragment();
    frag.appendChild(ZPLCanvas.#ce("link",{as:"style",type:"text/css",rel:"preload prefetch stylesheet",href:"./zpl-canvas/zpl-canvas.css"}));
    let div = frag.appendChild(ZPLCanvas.#ce("div",{class:"canvas-bg",part:"canvas-bg"}));
    let canvas = div.appendChild(ZPLCanvas.#ce("canvas",{part:"canvas"}));
    return frag
  }
  static #Fragment;
  static Fragment(){
    if(!ZPLCanvas.#Fragment){
      ZPLCanvas.#Fragment = ZPLCanvas.makeFragment()
    }
    return ZPLCanvas.#Fragment.cloneNode(true)
  }
}
customElements.define("zpl-canvas",ZPLCanvas);