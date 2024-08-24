import { ZPLParser, ZPLStream, ZPLLabel } from "./zpl-parser.js";
export { ZPLParser, ZPLStream, ZPLLabel }

export class ZPLCanvas extends HTMLElement{
  #canvas;
  #ctx;
  #scaleFactor;
  #label;
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
  get templateParams(){
    let ents = Object.entries(this.dataset).filter(a => a[0].startsWith("template_"));
    return Object.fromEntries(ents.map(a => [a[0].slice(9),a[1]]))
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
    let templateParams = Object.assign(this.templateParams,template);
    let result = zpl.render(this.canvasContext,templateParams);
    this.#label = zpl;
    return result
  }
  renderText(str,template = {}){
    let thing = ZPLParser.parse(str);
    if(!thing.isValid()){
      throw new Error("ZPL stream doesn't contain any labels, maybe missing ^XA or ^XZ ?")
    }
    return this.render(thing.labels[0],template);
    // do things
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