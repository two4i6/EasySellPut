import {applyTheme} from '../../app-sdk/presentation.mjs';
export function applyLocalPresentation(value:any){
 if(!applyTheme(value))return;
 window.dispatchEvent(new Event('resize'));window.dispatchEvent(new CustomEvent('qqq-local-theme',{detail:value}));
}
