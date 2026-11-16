'use client';

import { memo, useLayoutEffect, useRef } from 'react';
import type { ExposureTile } from './qqqExposureRenderModel';
import {heatmapIntensity,type HeatmapContrast} from '@/lib/qqqHeatmapPresentation';
import type { DayScenarioField } from '@/lib/qqqDayScenario';
import { dayScenarioTile } from './qqqDayScenarioRenderModel';

type Props = { tiles: readonly ExposureTile[]; rowHeight: number; size: { width: number; height: number }; plot: { left: number; top: number; width: number; height: number }; coverage: readonly { left: number; width: number }[]; maximum: number; gain: number; contrast:HeatmapContrast; inverted: boolean; smooth: number; blurX: number; blurY: number; raster?:{field:DayScenarioField;low:number;high:number} };

/** Bitmap rendering only. Tooltips continue to query unmodified snapshot values. */
export default memo(function QqqExposureCanvas({ tiles, rowHeight, size, plot, coverage, maximum, gain, contrast, inverted, smooth, blurX, blurY, raster }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const buffers = useRef<{ source: HTMLCanvasElement; blurred: HTMLCanvasElement } | null>(null);
  const rasterCache=useRef<{field:DayScenarioField;gain:number;contrast:HeatmapContrast;inverted:boolean;canvas:HTMLCanvasElement;low:number;high:number;unknown:Array<{column:number;row:number}>}|null>(null);
  useLayoutEffect(() => {
    const canvas = ref.current, ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width=Math.ceil(size.width*dpr),height=Math.ceil(size.height*dpr);
    if(canvas.width!==width)canvas.width=width;
    if(canvas.height!==height)canvas.height=height;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.globalAlpha=1;
    ctx.clearRect(0,0,size.width,size.height);
    // Rescale y before blurring to retain the original anisotropic display kernel.
    const strength = Math.max(0, Math.min(100, smooth)) / 100;
    const ratio = strength > 0 ? blurX / blurY : 1;
    buffers.current ??= {source:document.createElement('canvas'),blurred:document.createElement('canvas')};
    const {source,blurred}=buffers.current;
    if(source.width!==width)source.width=width;
    if(source.height!==Math.ceil(height*ratio))source.height=Math.ceil(height*ratio);
    const sourceCtx = source.getContext('2d');
    if (!sourceCtx) return;
    sourceCtx.setTransform(dpr,0,0,dpr*ratio,0,0);sourceCtx.globalAlpha=1;
    sourceCtx.clearRect(0,0,size.width,size.height);
    if(raster){
      const {field,low,high}=raster;
      let cached=rasterCache.current;
      if(!cached||cached.field!==field||cached.gain!==gain||cached.contrast!==contrast||cached.inverted!==inverted){
        const bitmap=document.createElement('canvas');bitmap.width=2048;bitmap.height=2048;
        const unknown:Array<{column:number;row:number}>=[];
        const paint=bitmap.getContext('2d');
        const bottom=field.prices[0]!-.125,top=field.prices.at(-1)!+.125;
        if(paint)field.times.forEach((time,column)=>{
          const left=Math.round((time-field.start)/(field.end-field.start)*bitmap.width);
          const right=Math.round(((field.times[column+1]??field.end)-field.start)/(field.end-field.start)*bitmap.width);
          field.prices.forEach((price,row)=>{
            const value=field.values[column*field.prices.length+row]!;
            if(!Number.isFinite(value)){unknown.push({column,row});return;}
            const lower=row>0?(field.prices[row-1]!+price)/2:bottom;
            const upper=row<field.prices.length-1?(field.prices[row+1]!+price)/2:top;
            paint.fillStyle=(inverted?value<0:value>=0)?'#60a5fa':'#fb923c';
            paint.globalAlpha=Math.min(.95,heatmapIntensity(value,maximum,contrast)*gain*1.15);
            // Shared pixel edges prevent translucent cells overlapping into a grid.
            const y=Math.round((top-upper)/(top-bottom)*bitmap.height),endY=Math.round((top-lower)/(top-bottom)*bitmap.height);
            paint.fillRect(left,y,right-left,endY-y);
          });
        });
        cached={field,gain,contrast,inverted,canvas:bitmap,low:bottom,high:top,unknown};rasterCache.current=cached;
      }
      sourceCtx.globalAlpha=1;
      // Reuse a field bitmap on wheel/quote updates; no per-cell color work.
      sourceCtx.drawImage(cached.canvas,plot.left,plot.top+(high-cached.high)/(high-low)*plot.height,plot.width,(cached.high-cached.low)/(high-low)*plot.height);
    } else for (const tile of tiles) {
      if(tile.value===null)continue;
      sourceCtx.fillStyle = (inverted ? tile.value < 0 : tile.value >= 0) ? '#60a5fa' : '#fb923c';
      sourceCtx.globalAlpha = Math.min(.95, heatmapIntensity(tile.value,maximum,contrast) * gain * 1.15);
      sourceCtx.fillRect(tile.left, tile.top, tile.width, tile.height??rowHeight);
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(plot.left, plot.top, plot.width, plot.height); ctx.clip();
    ctx.save();
    ctx.beginPath(); for (const run of coverage) ctx.rect(run.left, plot.top, run.width, plot.height); ctx.clip();
    // Blur in the rescaled bitmap, then stretch back to chart coordinates.
    if (strength > 0) {
      if(blurred.width!==source.width)blurred.width=source.width;
      if(blurred.height!==source.height)blurred.height=source.height;
      const blurredCtx = blurred.getContext('2d');
      if (blurredCtx) {
        for (const [radius, opacity] of [[blurX * 2.1 * strength, .14 * strength], [blurX * strength, .84 * strength]] as const) {
          blurredCtx.clearRect(0, 0, blurred.width, blurred.height);
          blurredCtx.filter = `blur(${radius * dpr}px)`; blurredCtx.drawImage(source, 0, 0);
          ctx.globalAlpha = opacity; ctx.drawImage(blurred, 0, 0, size.width, size.height);
        }
      }
      ctx.globalAlpha = 1 - .82 * strength;
    }
    ctx.drawImage(source, 0, 0, size.width, size.height);
    ctx.restore();
    // Clear unknown cells after blur so neighboring colors cannot fill missing inputs.
    ctx.globalAlpha=1;
    for(const tile of tiles)if(tile.value===null){
      ctx.clearRect(tile.left,tile.top,tile.width,tile.height??rowHeight);
    }
    if(raster)for(const {column,row} of rasterCache.current?.unknown??[]){
      const tile=dayScenarioTile(raster.field,column,row,raster.low,raster.high,plot);
      ctx.clearRect(tile.left,tile.top,tile.width,tile.height!);
    }
    ctx.restore();
  }, [tiles, rowHeight, size, plot, coverage, maximum, gain, contrast, inverted, smooth, blurX, blurY,raster]);
  return <canvas ref={ref} aria-hidden="true" style={{ width: size.width, height: size.height, display: 'block' }} />;
});
