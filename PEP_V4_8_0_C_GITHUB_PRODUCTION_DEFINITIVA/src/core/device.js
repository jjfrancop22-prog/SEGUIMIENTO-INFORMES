import {uuid} from './uuid.js';
const KEY='pep_v300_device_id';
export function getDeviceId(){
  let id=localStorage.getItem(KEY);
  if(!id){id=`DEV-${uuid()}`;localStorage.setItem(KEY,id)}
  return id;
}
