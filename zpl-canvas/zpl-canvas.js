import { ZPLParser, ZPLStream } from "./zpl-parser.js";
export { ZPLParser, ZPLStream }

export class ZPLCanvas extends HTMLElement{
  #canvas;
  #ctx;
  #scaleFactor;
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
  render(zpl){
    if(!(zpl instanceof ZPLStream)){
      throw new Error("argument 0 is not a ZPLStream")
    }
    const canvas = this.canvas;
    if(!zpl.isValid){
      
    }
    this.canvasContext.clearRect(0,0,this.canvas.width * (1/this.#scaleFactor),this.canvas.height * (1/this.#scaleFactor));
    // a zpl stream can contain more than one label, we only render the first one
    if(!zpl.isValid()){
      throw new Error("ZPL stream doesn't contain any labels, maybe missing ^XA or ^XF ?")
    }
    return zpl.labels[0].render(this.canvasContext);
  }
  renderText(str){
    let thing = ZPLParser.parse(str);
    return this.render(thing);
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
    frag.appendChild(ZPLCanvas.#ce("link",{as:"style",type:"text/css",rel:"preload prefetch stylesheet",href:"../zpl-canvas/zpl-canvas.css"}));
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