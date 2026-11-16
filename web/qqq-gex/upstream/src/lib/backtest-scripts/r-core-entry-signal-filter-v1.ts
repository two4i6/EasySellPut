/** Causal R entry predicates; callers declare role scope. No account, holdings, calendar or outcome inputs. */
export type RCoreEntryFilter='original-signal'|'soft-timing'|'not-dual'|'not-replace-main'|'not-pre-crisis'|'price-pullback'|'roc5-pullback'|'either-trend-pullback'|'not-original-signal'|'not-dual-credit2pct'|'not-dual-annual15pct'|'not-price-dual'|'not-price-dual-credit1pct'|'not-price-dual-credit2pct'|'not-price-dual-annual15pct'|'not-price-dual-positive-extension'|'not-price-dual-positive-roc5'|'not-price-dual-extension3'|'not-price-dual-extension2'|'not-price-dual-positive-both-roc'|'not-price-dual-strong-quality';
export type RCoreEntryObservation={quality?:number;qualityObserved?:boolean;dualQuality?:boolean;originalSignal?:boolean;softTiming?:boolean;dual?:boolean;replacesMain?:boolean;preCrisisActive?:boolean;priceExtensionAtr?:number;roc5?:number;roc20?:number;regime?:string;premiumWidthRatio?:number;annualizedQuoteCarry?:number};
export function rCoreEntrySignalAllowed(rule:RCoreEntryFilter,o:Readonly<RCoreEntryObservation>){
 const nonpositive=(value:number|undefined)=>typeof value==='number'&&Number.isFinite(value)&&value<=0;
 switch(rule){
 case 'not-price-dual-strong-quality':return o.originalSignal===false||o.dualQuality===false||(o.originalSignal===true&&o.dualQuality===true&&o.qualityObserved===true&&typeof o.quality==='number'&&Number.isFinite(o.quality)&&o.quality<.65);
 case 'not-price-dual-extension3':return o.originalSignal===false||o.dualQuality===false||(o.originalSignal===true&&o.dualQuality===true&&typeof o.priceExtensionAtr==='number'&&Number.isFinite(o.priceExtensionAtr)&&o.priceExtensionAtr<3);
 case 'not-price-dual-extension2':return o.originalSignal===false||o.dualQuality===false||(o.originalSignal===true&&o.dualQuality===true&&typeof o.priceExtensionAtr==='number'&&Number.isFinite(o.priceExtensionAtr)&&o.priceExtensionAtr<2);
 case 'not-price-dual-positive-both-roc':return o.originalSignal===false||o.dualQuality===false||(o.originalSignal===true&&o.dualQuality===true&&(nonpositive(o.roc5)||nonpositive(o.roc20)));
 case 'not-price-dual-positive-extension':return o.originalSignal===false||o.dualQuality===false||(o.originalSignal===true&&o.dualQuality===true&&nonpositive(o.priceExtensionAtr));
 case 'not-price-dual-positive-roc5':return o.originalSignal===false||o.dualQuality===false||(o.originalSignal===true&&o.dualQuality===true&&nonpositive(o.roc5));
 case 'not-price-dual':return o.originalSignal===false||o.dualQuality===false;
 case 'not-price-dual-credit1pct':return (o.originalSignal===false||o.dualQuality===false)&&typeof o.premiumWidthRatio==='number'&&Number.isFinite(o.premiumWidthRatio)&&o.premiumWidthRatio>=.01;
 case 'not-price-dual-credit2pct':return (o.originalSignal===false||o.dualQuality===false)&&typeof o.premiumWidthRatio==='number'&&Number.isFinite(o.premiumWidthRatio)&&o.premiumWidthRatio>=.02;
 case 'not-price-dual-annual15pct':return (o.originalSignal===false||o.dualQuality===false)&&typeof o.annualizedQuoteCarry==='number'&&Number.isFinite(o.annualizedQuoteCarry)&&o.annualizedQuoteCarry>=.15;
 case 'not-original-signal':return o.originalSignal===false;
 case 'not-dual-credit2pct':return o.dual===false&&typeof o.premiumWidthRatio==='number'&&Number.isFinite(o.premiumWidthRatio)&&o.premiumWidthRatio>=.02;
 case 'not-dual-annual15pct':return o.dual===false&&typeof o.annualizedQuoteCarry==='number'&&Number.isFinite(o.annualizedQuoteCarry)&&o.annualizedQuoteCarry>=.15;
 case 'original-signal':return o.originalSignal===true;
 case 'soft-timing':return o.softTiming===true;
 case 'not-dual':return o.dual===false;
 case 'not-replace-main':return o.replacesMain===false;
 case 'not-pre-crisis':return o.preCrisisActive===false;
 case 'price-pullback':return nonpositive(o.priceExtensionAtr);
 case 'roc5-pullback':return nonpositive(o.roc5);
 case 'either-trend-pullback':return nonpositive(o.roc5)||nonpositive(o.roc20);
 }
}
