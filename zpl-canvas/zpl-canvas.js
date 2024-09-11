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
    return Object.fromEntries(ents.map(a => [a[0].slice(9),a[1]]));
  }
  get templateParams(){
    if(this.label?.isValid()){
      let things = Object.assign(this.label.templateFields,this.templateAttributes);
      let formItems = Array.from(this.templateForm.children);
      for(let [key,val] of Object.entries(things)){
        let match = formItems.find(a => a.dataset.key === key);
        if(match && match.value){
          things[key] = match.value;
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
    let frag = new DocumentFragment();
    for(let [key,val] of Object.entries(params)){
      let item = formItems.find(a => a.dataset.key === key);
      if(!item){
        let tr = ZPLCanvas.formRowFragment(this);
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
        child.remove()
      }
    }
    toBePreserved.clear();
    form.append(frag);
  }
  handleEvent(ev){
    if(ev.type === "input" && ev.target.dataset.type === "form-input"){
      this.render()
    }
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
  static initFormRowItem(item,zpl){
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
      },
      value:{
        get(){
          return this.input.value
        }
      }
    });
    item.input.addEventListener("input",zpl);
    return item
  }
  static #formRowFragment;
  static formRowFragment(zpl){
    if(!this.#formRowFragment){
      let frag = document.createDocumentFragment();
      let tr = createElement("tr",{class: "templatelist-item"});
      tr.appendChild(createElement("td",{class: "templatelist-label"}));
      let cell = tr.appendChild(createElement("td",{class: "templatelist-value"}));
      let input = cell.appendChild(createElement("input",{type:"text",placeholder: "template value","data-type": "form-input"}));
      frag.appendChild(tr);
      this.#formRowFragment = frag
    }
    return this.initFormRowItem(this.#formRowFragment.firstChild.cloneNode(true),zpl)
  }
}

customElements.define("zpl-canvas",ZPLCanvas);
