#!/usr/bin/env python3
"""Check actual native scenario captures: DOM order alone missed a WebKit compositor bug."""
import json
import pathlib
import sys
from PIL import Image

root=pathlib.Path(sys.argv[1]);records=[]
for width in (1000,1440):
    for theme in ('light','dark'):
        path=root/f'desktop-smoke-gex-scenario-{width}-{theme}.png'
        with Image.open(path) as image:
            assert image.format=='PNG' and 800<=image.width<=5000 and 400<=image.height<=3000,(path,image.size)
            assert image.width*image.height<=12000000,(path,image.size)
            rgb=image.convert('RGB');colors=rgb.getcolors(rgb.width*rgb.height)
            assert colors and len(colors)>24,(path,'blank or invalid capture')
            # The opaque inspection card has this source palette color in both
            # themes. A small tolerance allows native color-profile conversion.
            pixels=sum(n for n,color in colors if all(abs(a-b)<=6 for a,b in zip(color,(17,24,39))))
            records.append(dict(file=path.name,width=image.width,height=image.height,opaqueInspectionPixels=pixels,minimum=1000))
report=root/'desktop-smoke-gex-pixels.json';report.write_text(json.dumps(records,indent=2)+'\n',encoding='utf-8')
print(json.dumps(records))
assert all(r['opaqueInspectionPixels']>=r['minimum'] for r in records),'Opaque inspection missing/covered in native pixels; inspect '+str(report)
