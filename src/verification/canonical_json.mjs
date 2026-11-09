function canonicalize(value){
 if(Array.isArray(value))return value.map(canonicalize);
 if(!value||typeof value!=='object')return value;
 if(typeof value.toJSON==='function')return canonicalize(value.toJSON());
 return Object.fromEntries(Object.keys(value).sort()
  .map(key=>[key,canonicalize(value[key])]));
}

export function canonicalJson(value){
 return JSON.stringify(canonicalize(value));
}
