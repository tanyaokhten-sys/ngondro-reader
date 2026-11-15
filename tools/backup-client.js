// Counter backup / restore ("Зберегти копію" / "Відновити").
// Injected into the built bundle by tools/build.py, before the counter
// component. Uses the bundle's module scope: Hu (storage prefix), Nr
// (practices), o (jsx runtime), X (React).

function __ngB64(s){const b=new TextEncoder().encode(s);let r="";for(let i=0;i<b.length;i++)r+=String.fromCharCode(b[i]);return btoa(r)}
function __ngUnB64(s){const r=atob(s),b=new Uint8Array(r.length);for(let i=0;i<r.length;i++)b[i]=r.charCodeAt(i);return new TextDecoder().decode(b)}
function __ngBackupAt(){try{return+localStorage.getItem(Hu+"backupAt")||0}catch{return 0}}

const __NG_BACKUP_SKIP = new Set(["backupAt", "acct", "sync", "device", "counters.premigration"]);

async function __ngExport(){
  const d={};
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i);
    if(k&&k.startsWith(Hu)&&!__NG_BACKUP_SKIP.has(k.slice(Hu.length)))d[k.slice(Hu.length)]=localStorage.getItem(k);
  }
  try{const c=JSON.parse(d.counters||"{}");for(const id in c)if(c[id]&&Array.isArray(c[id].log))c[id].log=c[id].log.slice(-100);d.counters=JSON.stringify(c)}catch{}
  const at=Date.now(),code="NGONDRO1:"+__ngB64(JSON.stringify({at,d}));
  let ok=false;
  if(navigator.share){try{await navigator.share({title:"Ньондро — копія лічильника",text:code});ok=true}catch(e){if(e&&e.name==="AbortError")return false}}
  if(!ok&&navigator.clipboard&&navigator.clipboard.writeText){try{await navigator.clipboard.writeText(code);alert("Код копії скопійовано. Збережіть його, наприклад, у Нотатках.");ok=true}catch{}}
  if(!ok){window.prompt("Скопіюйте цей код і збережіть його:",code);ok=true}
  try{localStorage.setItem(Hu+"backupAt",String(at))}catch{}
  return ok;
}

function __ngImport(){
  const s=window.prompt("Вставте код копії (починається з NGONDRO1:)");
  if(!s)return;
  let b;
  try{const m=s.replace(/\s+/g,"").match(/NGONDRO1:([A-Za-z0-9+/=]+)/);b=JSON.parse(__ngUnB64(m[1]));if(!b||typeof b.d!=="object")throw 0}
  catch{alert("Не вдалося прочитати код. Перевірте, що скопіювали його повністю.");return}
  let cur={},bk={};
  try{cur=JSON.parse(localStorage.getItem(Hu+"counters")||"{}")||{}}catch{}
  try{bk=JSON.parse(b.d.counters||"{}")||{}}catch{}
  const merged={...cur};let changed=0;
  for(const id in bk){const x=bk[id];if(x&&typeof x.total=="number"&&(!cur[id]||x.total>(cur[id].total||0))){merged[id]=x;changed++}}
  const fmt=n=>Number(n||0).toLocaleString("uk");
  const lines=Object.keys(bk).map(id=>(Nr.get(id)?.short||id)+": "+fmt(bk[id]?.total)+(cur[id]?" (зараз "+fmt(cur[id].total)+")":""));
  if(!confirm("Відновити копію від "+new Date(b.at).toLocaleString("uk")+"?\n\n"+lines.join("\n")+"\n\nДля кожної практики залишиться більше з двох чисел — нічого не загубиться."))return;
  try{
    // Signed in: the increase becomes 'import' events so the account gets it too.
    if(changed&&typeof __ngRestoreIntoAccount==="function")__ngRestoreIntoAccount(cur,merged);
    if(changed)localStorage.setItem(Hu+"counters",JSON.stringify(merged));
    for(const k in b.d)if(k!=="counters"&&!__NG_BACKUP_SKIP.has(k)&&localStorage.getItem(Hu+k)==null)localStorage.setItem(Hu+k,b.d[k]);
  }catch{alert("Не вдалося зберегти дані на цьому пристрої.");return}
  location.reload();
}

function __NgBackupRow({total:t}){
  // When signed in, the account is the backup, so no "old backup" warning.
  const[,f]=X.useState(0),at=__ngBackupAt(),old=!__ngAcct().owner&&t>0&&Date.now()-at>6048e5;
  const label=at?"Копія: "+new Date(at).toLocaleDateString("uk"):"Копію ще не збережено";
  return o.jsxs("div",{className:"counter-backup",children:[
    o.jsx("span",{className:old?"warn":"",children:old&&at?"Копія давно не оновлювалась":label}),
    o.jsxs("span",{className:"counter-backup-btns",children:[
      o.jsx("button",{type:"button",className:"linklike",onClick:async()=>{await __ngExport()&&f(n=>n+1)},children:"Зберегти копію"}),
      o.jsx("button",{type:"button",className:"linklike",onClick:__ngImport,children:"Відновити"})]})]});
}
