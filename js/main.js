import { ZPLCanvas, ZPLParser } from "../zpl-canvas/zpl-canvas.js";
'use strict';

let lazyTimeout;
function lazyMakeSymbol(){
	if(lazyTimeout){
		window.clearTimeout(lazyTimeout);
	}
	lazyTimeout = window.setTimeout(renderThing, 250);
}

function renderThing(){
  let textField = document.getElementById("textbox");
  let zplcanvas = document.getElementById("zpl-canvas");
  try{
    let draws = zplcanvas.renderText(textField.value);
    textField.classList.remove("invalid");
    onRenderCallback({message: "Success!", calls : draws})
  }catch(ex){
    textField.classList.add("invalid")
    onRenderCallback(ex)
  }
}

function onRenderCallback(ex){
  let el = document.getElementById("errorlist");
  while(el.children.length > 0){
    el.children[0].remove();
  }
  if(ex.calls){
    for(let call of ex.calls.filter(c => !c.ok)){
      let li = el.appendChild(document.createElement("li"));
      li.textContent = "Failure: ";
      li.appendChild(document.createElement("code")).textContent = call.command;
      li.append(" - "+call.reason)
    }
  }else{
    // error message
    el.appendChild(document.createElement("li")).textContent = ex.message
  }
  
}

function init(){
  console.log(`${document.title} has been loaded`);
  let zplcanvas = document.getElementById("zpl-canvas");
  window.zplcanvas = zplcanvas;
  let textField = document.getElementById("textbox");
  textField.addEventListener("input",lazyMakeSymbol,false)
}

document.onreadystatechange = () => {
  if (document.readyState === "complete") {
    init();
  }
}