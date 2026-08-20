export function resolveWorkspaceTabName(original:string,draft:string,action:'commit'|'cancel'){
  if(action==='cancel')return original
  return draft.trim()||original
}
