/**
 * HTML-Seite für die WebView, die ein PDF mit dem eingebetteten PDF.js
 * anzeigt (Android-WebView kann PDFs nicht selbst darstellen).
 * Der Worker läuft im Hauptthread (global `pdfjsWorker`) – kein Blob/Netz nötig.
 */
import { PDFJS_JS, PDFJS_WORKER_JS } from "./pdfjsBundle";

export function buildPdfViewerHtml(base64: string, background = "#202431"): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes">
<style>
html,body{margin:0;padding:0;background:${background};}
#pages{display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px 0;}
canvas{background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.4);max-width:100%;height:auto;}
#msg{color:#ccc;font:15px sans-serif;text-align:center;padding:24px;}
</style></head><body>
<div id="msg">PDF wird geladen …</div><div id="pages"></div>
<script>${PDFJS_WORKER_JS}</script>
<script>${PDFJS_JS}</script>
<script>
(function(){
  var post=function(t,m){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:t,message:m||""}));}catch(e){}};
  try{
    var b64="${base64}";
    var raw=atob(b64), bytes=new Uint8Array(raw.length);
    for(var i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
    var lib=window.pdfjsLib;
    lib.getDocument({data:bytes, isEvalSupported:false}).promise.then(function(pdf){
      document.getElementById("msg").style.display="none";
      var box=document.getElementById("pages");
      var cssW=Math.min(window.innerWidth-16, 1400);
      var ratio=Math.min(window.devicePixelRatio||1, 2);
      var chain=Promise.resolve();
      for(var n=1;n<=pdf.numPages;n++){(function(n){
        chain=chain.then(function(){return pdf.getPage(n);}).then(function(page){
          var v1=page.getViewport({scale:1});
          var scale=cssW/v1.width;
          var vp=page.getViewport({scale:scale*ratio});
          var c=document.createElement("canvas");
          c.width=Math.floor(vp.width); c.height=Math.floor(vp.height);
          c.style.width=Math.floor(vp.width/ratio)+"px";
          box.appendChild(c);
          return page.render({canvasContext:c.getContext("2d"),viewport:vp}).promise;
        });
      })(n);}
      return chain.then(function(){post("loaded");});
    }).catch(function(e){document.getElementById("msg").textContent="PDF konnte nicht angezeigt werden.";post("error",String(e&&e.message||e));});
  }catch(e){document.getElementById("msg").textContent="PDF konnte nicht angezeigt werden.";post("error",String(e&&e.message||e));}
})();
</script></body></html>`;
}
