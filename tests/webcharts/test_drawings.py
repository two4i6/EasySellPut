#!/usr/bin/env python3
"""Real pointer gestures -> private C# channel -> persistent drawing store."""
import json
import os
import pathlib
import select
import subprocess
import unittest
from playwright.sync_api import expect, sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]

class DrawingTests(unittest.TestCase):
    def test_preview_cancel_pane_guards_edit_and_single_delete(self):
        process = subprocess.Popen(['dotnet',str(ROOT/'tests/Meili.Workbench.Host/bin/Release/net10.0/Meili.Workbench.Host.dll'),'--chart'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,cwd=ROOT)
        try:
            ready,_,_=select.select([process.stdout],[],[],45)
            self.assertTrue(ready)
            url=json.loads(process.stdout.readline())['url']
            with sync_playwright() as pw:
                browser=pw.chromium.launch(headless=True,**({'executable_path':os.environ['MEILI_CHROMIUM']} if os.environ.get('MEILI_CHROMIUM') else {}))
                p=browser.new_page(viewport=dict(width=1320,height=850));errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
                requests=[];p.on('request',lambda req:requests.append(req.post_data) if req.method=='POST' and req.post_data and json.loads(req.post_data).get('kind','').startswith('drawing') else None)
                p.goto(url);p.wait_for_function('()=>window.meiliChart?.inspect().state?.rows.length===120')
                def wait(expression):
                    try:p.wait_for_function('()=>('+expression+')',timeout=10000)
                    except Exception:
                        print('STATE',p.evaluate('(()=>{const s=meiliChart.inspect().state;return {mode:s.drawingMode,start:s.drawingStart,drawings:s.drawings}})()'),'ERRORS',errors,'REQUESTS',requests)
                        raise
                def mode(command,kind):
                    process.stdin.write(command+'\n');process.stdin.flush();wait('meiliChart.inspect().state.drawingMode==='+json.dumps(kind))
                def point(index,price):
                    return p.evaluate('''([index,price])=>{const {chart,series,state}=meiliChart.inspect();return {x:chart.timeScale().timeToCoordinate(state.rows[index].time),y:series.candles.priceToCoordinate(price)}}''',[index,price])
                def move(index,price,click=False):
                    at=point(index,price);bounds=p.locator('#chart').bounding_box();p.mouse.move(bounds['x']+at['x'],bounds['y']+at['y'])
                    if click:p.mouse.click(bounds['x']+at['x'],bounds['y']+at['y'])
                def capture(name):
                    if directory:=os.environ.get('MEILI_RENDER_DIR'):
                        pathlib.Path(directory).mkdir(parents=True,exist_ok=True);p.screenshot(path=str(pathlib.Path(directory)/(name+'.png')))
                p.locator('#fit').click();p.wait_for_timeout(100)
                mode('draw-horizontal','HorizontalLine');move(30,140);p.wait_for_timeout(100)
                self.assertEqual(p.locator('#drawing-overlay line').count(),1)
                self.assertFalse(p.evaluate('meiliChart.inspect().chart.options().handleScroll.pressedMouseMove'))
                # A click on volume must never turn its pane-relative y into a stock price.
                bounds=p.locator('#chart').bounding_box();height=p.evaluate('meiliChart.inspect().chart.panes()[0].getHeight()')
                p.mouse.click(bounds['x']+200,bounds['y']+height+20);p.wait_for_timeout(350)
                self.assertEqual(p.evaluate('meiliChart.inspect().state.drawings.length'),0)
                p.keyboard.press('Escape');wait('meiliChart.inspect().state.drawingMode===null');p.wait_for_timeout(300)
                self.assertTrue(p.evaluate('meiliChart.inspect().chart.options().handleScroll.pressedMouseMove'))
                mode('draw-trend','TrendLine');move(30,140,True);wait('!!meiliChart.inspect().state.drawingStart')
                move(75,180);p.wait_for_timeout(120)
                self.assertEqual(p.locator('#drawing-overlay circle').count(),2);capture('drawing-trend-preview-dark')
                # First point survives live re-render without creating a hidden/incomplete stored line.
                p.evaluate('meiliChart.render(structuredClone(meiliChart.inspect().state))');move(30,145,True);p.wait_for_timeout(100)
                self.assertEqual(p.evaluate('meiliChart.inspect().state.drawings.length'),0)
                self.assertIn('另一根',p.locator('#drawing-hint').inner_text())
                p.keyboard.press('Escape');wait('!meiliChart.inspect().state.drawingMode');p.wait_for_timeout(300);self.assertEqual(p.locator('#drawing-overlay circle').count(),0)
                mode('draw-trend','TrendLine');move(30,140,True);wait('!!meiliChart.inspect().state.drawingStart');move(75,180,True)
                wait('meiliChart.inspect().state.drawings.length===1 && !meiliChart.inspect().state.drawingMode')
                mode('draw-horizontal','HorizontalLine');move(90,250,True);wait('meiliChart.inspect().state.drawings.length===2')
                bounds=p.locator('#chart').bounding_box();height=p.evaluate('meiliChart.inspect().chart.panes()[0].getHeight()')
                p.mouse.click(bounds['x']+200,bounds['y']+height+point(90,250)['y']);p.wait_for_timeout(80)
                self.assertFalse(p.locator('#drawing-panel').is_visible())
                # Select near the segment midpoint, edit exactly, then delete only that line.
                def select_trend():
                    a=point(30,p.evaluate('meiliChart.inspect().state.drawings[0].price1'));b=point(75,180);bounds=p.locator('#chart').bounding_box()
                    p.mouse.click(bounds['x']+(a['x']+b['x'])/2,bounds['y']+(a['y']+b['y'])/2)
                    self.assertTrue(p.locator('#drawing-panel').is_visible())
                    return bounds['x']+(a['x']+b['x'])/2,bounds['y']+(a['y']+b['y'])/2
                target=select_trend();p.keyboard.press('Escape');p.mouse.dblclick(*target,delay=20);self.assertTrue(p.locator('#drawing-panel').is_visible())
                p.locator('#drawing-first').fill('150');capture('drawing-selected-dark');p.locator('#drawing-save').click()
                wait('meiliChart.inspect().state.drawings[0].price1===150')
                process.stdin.write('light\nen-US\n');process.stdin.flush();wait('!meiliChart.inspect().state.theme.dark && meiliChart.inspect().state.language==="en-US"')
                select_trend();self.assertEqual(p.locator('#drawing-save').inner_text(),'Save');capture('drawing-selected-light')
                p.locator('#drawing-delete').click();wait('meiliChart.inspect().state.drawings.length===1')
                self.assertEqual(p.evaluate('meiliChart.inspect().state.drawings[0].kind'),'HorizontalLine')
                p.locator('#chart').focus();p.keyboard.press('ArrowDown');self.assertTrue(p.locator('#drawing-panel').is_visible())
                p.keyboard.press('Enter');self.assertTrue(p.locator('#drawing-first').evaluate('(e)=>e===document.activeElement'))
                p.locator('#drawing-first').fill('196');p.keyboard.press('Enter');wait('meiliChart.inspect().state.drawings[0].price1===196')
                p.set_viewport_size(dict(width=480,height=800));p.locator('#chart').focus();p.keyboard.press('ArrowDown');p.wait_for_timeout(100)
                self.assertLessEqual(p.locator('body').evaluate('(e)=>e.scrollWidth'),480)
                panel=p.locator('#drawing-panel').bounding_box();self.assertGreaterEqual(panel['x'],0);self.assertLessEqual(panel['x']+panel['width'],480)
                capture('drawing-selected-compact');p.locator('#chart').focus();p.keyboard.press('Delete');wait('meiliChart.inspect().state.drawings.length===0')
                p.set_viewport_size(dict(width=1320,height=850))
                p.locator('#fit').click()
                def choose(kind):
                    p.locator('#draw-tools-label').click()
                    p.locator('[data-drawing-tool="'+kind+'"]').click()
                    wait('meiliChart.inspect().state.drawingMode==='+json.dumps(kind))

                choose('HorizontalRay')
                move(30,142,True)
                wait('meiliChart.inspect().state.drawings[0]?.kind==="HorizontalRay"')
                ray=p.locator('#drawing-overlay line').first
                self.assertAlmostEqual(float(ray.get_attribute('x1')),point(30,142)['x'],delta=1)
                self.assertGreater(float(ray.get_attribute('x2')),point(90,142)['x'])

                choose('VerticalLine')
                move(63,180,True)
                wait('meiliChart.inspect().state.drawings[1]?.kind==="VerticalLine"')
                move(63,190,True)
                self.assertTrue(p.locator('#drawing-time1').is_visible())
                self.assertFalse(p.locator('#drawing-first').is_visible())
                time=p.evaluate('meiliChart.inspect().state.rows[64].time')
                p.locator('#drawing-time1').select_option(str(time))
                p.locator('#drawing-save').click()
                wait('meiliChart.inspect().state.drawings[1].time1==='+str(time))
                p.keyboard.press('Escape')

                choose('Rectangle')
                move(42,150,True)
                wait('!!meiliChart.inspect().state.drawingStart')
                move(83,174)
                self.assertEqual(p.locator('#drawing-overlay rect').count(),1)
                move(83,174,True)
                wait('meiliChart.inspect().state.drawings[2]?.kind==="Rectangle"')
                self.assertEqual(p.locator('#drawing-overlay rect').count(),1)

                choose('FibonacciRetracement')
                move(50,162,True)
                wait('!!meiliChart.inspect().state.drawingStart')
                move(105,204,True)
                wait('meiliChart.inspect().state.drawings[3]?.kind==="FibonacciRetracement"')
                self.assertEqual(p.locator('#drawing-overlay .drawing-level').count(),7)
                self.assertIn('61.8%',p.locator('#drawing-overlay').text_content())
                capture('drawing-tools-expanded')
                p.reload()
                wait('meiliChart.inspect().state.drawings.length===4')
                self.assertEqual(p.locator('#drawing-overlay .drawing-level').count(),7)
                p.locator('#chart').focus()
                p.keyboard.press('ArrowDown')
                p.locator('#drawing-select').select_option('2')
                p.locator('#drawing-delete').click()
                wait('meiliChart.inspect().state.drawings.length===3')
                self.assertEqual(p.locator('#drawing-overlay rect').count(),0)
                for count in (3,2,1):
                    p.locator('#chart').focus();p.keyboard.press('ArrowDown');p.keyboard.press('Delete')
                    wait(f'meiliChart.inspect().state.drawings.length==={count-1}')

                choose('LongPosition')
                move(24,151,True)
                wait('!!meiliChart.inspect().state.drawingStart')
                move(51,174,True)
                wait('!!meiliChart.inspect().state.drawingTarget')
                self.assertEqual(p.evaluate('meiliChart.inspect().state.drawings.length'),0)
                move(51,163,True)
                expect(p.locator('#drawing-hint')).to_contain_text('losing side')
                move(51,139,True)
                wait('meiliChart.inspect().state.drawings[0]?.kind==="LongPosition"')
                self.assertEqual(p.locator('.position-zone').count(),2)
                self.assertIn('R/R',p.locator('#drawing-overlay').text_content())

                choose('ShortPosition')
                move(68,191,True)
                wait('!!meiliChart.inspect().state.drawingStart')
                move(96,174,True)
                wait('!!meiliChart.inspect().state.drawingTarget')
                move(96,205,True)
                wait('meiliChart.inspect().state.drawings[1]?.kind==="ShortPosition"')
                self.assertEqual(p.locator('.position-zone').count(),4)
                p.locator('#chart').focus();p.keyboard.press('ArrowDown')
                p.locator('#drawing-select').select_option('1')
                p.locator('#drawing-stop').fill('209')
                p.locator('#drawing-save').click()
                wait('meiliChart.inspect().state.drawings[1].stopPrice===209')
                p.keyboard.press('Escape')

                choose('PriceRange')
                move(42,131,True)
                wait('!!meiliChart.inspect().state.drawingStart')
                move(42,217,True)
                wait('meiliChart.inspect().state.drawings[2]?.kind==="PriceRange"')
                self.assertTrue(p.evaluate('meiliChart.inspect().state.drawings[2].time1===null'))
                self.assertIn('Upper',p.locator('#drawing-overlay').text_content())
                self.assertIn('Lower',p.locator('#drawing-overlay').text_content())
                capture('position-and-price-range')
                p.reload()
                wait('meiliChart.inspect().state.drawings.length===3')
                self.assertEqual(p.locator('.position-zone').count(),4)

                process.stdin.write('dark\nzh-CN\n');process.stdin.flush()
                wait('meiliChart.inspect().state.theme.dark && meiliChart.inspect().state.language==="zh-CN"')
                expect(p.locator('#drawing-overlay')).to_contain_text('盈亏比')
                expect(p.locator('#drawing-overlay')).to_contain_text('上沿')
                capture('position-and-price-range-dark')
                p.set_viewport_size(dict(width=560,height=760))
                choose('PriceRange')
                expect(p.locator('#drawing-hint')).to_contain_text('选择起点')
                self.assertLessEqual(p.locator('body').evaluate('(body)=>body.scrollWidth'),560)
                p.keyboard.press('Escape')
                wait('meiliChart.inspect().state.drawingMode===null')
                self.assertFalse(errors);browser.close()
        finally:
            process.stdin.write('quit\n');process.stdin.flush();process.communicate(timeout=15)
            self.assertEqual(process.returncode,0)

if __name__=='__main__':unittest.main()
