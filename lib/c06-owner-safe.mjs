import {classifyC06Effect} from './c06-model-candidate.js';
// Independent owner-boundary adapter around immutable model-generated logic.
// Explicit own data properties only: never infer authority through prototypes,
// getters, truthiness, unrecognized effect types, or oversized/free-form inputs.
const KEYS=Object.freeze(['authorized','paused','paidCents','providerStatus','receiptVerified']);
const STATUSES=new Set(['observed','unknown','timeout']);
export function evaluateC06OwnerEffect(input){
 if(!input||typeof input!=='object'||Array.isArray(input))return 'held';
 const prototype=Object.getPrototypeOf(input);
 if(prototype!==Object.prototype&&prototype!==null)return 'held';
 const keys=Reflect.ownKeys(input);
 if(keys.length!==KEYS.length||keys.some(key=>!KEYS.includes(key)))return 'held';
 const fields=Object.getOwnPropertyDescriptors(input);
 if(KEYS.some(key=>!Object.hasOwn(fields,key)||!Object.hasOwn(fields[key],'value')))return 'held';
 const values=Object.fromEntries(KEYS.map(key=>[key,fields[key].value]));
 if(values.authorized!==true||values.paused!==false||
  values.paidCents!==0||typeof values.receiptVerified!=='boolean'||
  !STATUSES.has(values.providerStatus))return 'held';
 return classifyC06Effect(values);
}
