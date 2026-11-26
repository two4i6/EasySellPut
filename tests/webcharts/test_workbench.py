#!/usr/bin/env python3
"""Actual browser -> private HTTP -> C# strategy model -> rendered payoff, with explicit offline fixture data."""
import json
import os
import pathlib
import select
import subprocess
import unittest
import time
from playwright.sync_api import sync_playwright

ROOT=pathlib.Path(__file__).resolve().parents[2]

class WorkbenchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        dll=ROOT/'tests/Meili.Workbench.Host/bin/Release/net10.0/Meili.Workbench.Host.dll'
        cls.process=subprocess.Popen(['dotnet',str(dll)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,cwd=ROOT)
        ready,_,_=select.select([cls.process.stdout],[],[],45)
        if not ready: cls.process.kill();raise RuntimeError('Fixture host did not start')
        line=cls.process.stdout.readline()
        if not line: raise RuntimeError(cls.process.stderr.read())
        cls.url=json.loads(line)['url'];cls.errors=[]
        cls.playwright=sync_playwright().start()
        executable=os.environ.get('MEILI_CHROMIUM')
        cls.browser=cls.playwright.chromium.launch(headless=True,**({'executable_path':executable} if executable else {}))
        cls.page=cls.browser.new_page(viewport=dict(width=1920,height=1080));cls.page.on('pageerror',lambda e:cls.errors.append(str(e)))
        cls.page.goto(cls.url);cls.wait(cls.page,'window.meiliWorkbench?.inspect().state?.contracts.length === 18')
    @staticmethod
    def wait(page,expression,arg=None):
        # CDP function calls can inspect the page without weakening its production CSP.
        function=expression if '=>' in expression else '()=>('+expression+')'
        deadline=time.monotonic()+30
        while not page.evaluate(function,arg):
            if time.monotonic()>deadline: raise TimeoutError(expression)
            page.wait_for_timeout(100)
    @classmethod
    def tearDownClass(cls):
        cls.browser.close();cls.playwright.stop()
        cls.process.stdin.write('quit\n');cls.process.stdin.flush();cls.process.communicate(timeout=15)
        if cls.process.returncode: raise RuntimeError('Fixture host exit '+str(cls.process.returncode))
    def setUp(self):
        self.page.locator('#rightCall').click()
        if self.page.evaluate('meiliWorkbench.inspect().state.legs.length'):
            self.page.locator('#clear').click();self.wait(self.page,'meiliWorkbench.inspect().state.legs.length === 0')
    def command(self,value): self.process.stdin.write(value+'\n');self.process.stdin.flush()
    def test_add_spread_edit_quantity_remove_and_what_if_reach_real_backend(self):
        p=self.page
        p.locator('button.buy[data-contract="Call100"]').click();self.wait(p,'meiliWorkbench.inspect().state.legs.length === 1')
        p.locator('button.sell[data-contract="Call110"]').click();self.wait(p,'meiliWorkbench.inspect().state.legs.length === 2')
        data=p.evaluate('meiliWorkbench.inspect().state')
        self.assertEqual(data['legs'][0]['premium'],'3.25');self.assertEqual(data['legs'][1]['premium'],'1.25')
        self.assertEqual(data['curve'][-1]['expiry'],800)
        self.assertEqual(data['curve'][0]['expiry'],-200)
        output=os.environ.get('MEILI_RENDER_DIR')
        if output:
            pathlib.Path(output).mkdir(parents=True,exist_ok=True);p.screenshot(path=str(pathlib.Path(output)/'workbench-spread-1920.png'))
        selected=p.locator('button.buy[data-contract="Call100"]');self.assertEqual(selected.get_attribute('aria-pressed'),'true')
        p.locator('#workbenchDetails summary').click();self.assertTrue(p.locator('#notes').is_visible());p.locator('#workbenchDetails summary').click()

        self.assertEqual(p.locator('svg path[data-series="expiry"]').count(),1)
        qty=p.locator('#legs input').first;qty.fill('2');qty.press('Tab')
        self.wait(p,'meiliWorkbench.inspect().state.legs[0].quantity === "2"')
        self.assertEqual(p.evaluate('meiliWorkbench.inspect().state.legs[0].premium'),'3.25')
        self.assertEqual(p.locator('#legs tbody tr').first.evaluate('(e)=>e.getAnimations().length'),0)
        span=p.evaluate('meiliWorkbench.inspect().domain.high-meiliWorkbench.inspect().domain.low')
        plot_bounds=p.locator('#payoff').bounding_box();p.mouse.move(plot_bounds['x']+plot_bounds['width']/2,plot_bounds['y']+plot_bounds['height']/2);p.mouse.wheel(0,-300)
        self.assertLess(p.evaluate('meiliWorkbench.inspect().domain.high-meiliWorkbench.inspect().domain.low'),span)
        p.locator('#fit').click()
        previous=p.evaluate('meiliWorkbench.inspect().state.whatIf.price')
        bounds=p.locator('#payoff').bounding_box();p.mouse.move(bounds['x']+bounds['width']*.7,bounds['y']+bounds['height']*.5)
        self.wait(p,'(previous)=>meiliWorkbench.inspect().state.whatIf.price !== previous',arg=previous)
        self.assertTrue(p.evaluate('Number.isFinite(meiliWorkbench.inspect().state.greeks.delta)'))
        p.locator('#legs tbody tr').first.locator('button').click();self.wait(p,'meiliWorkbench.inspect().state.legs.length === 1')
        p.locator('#clear').click();self.wait(p,'meiliWorkbench.inspect().state.legs.length === 0')
        self.assertEqual(p.evaluate('meiliWorkbench.inspect().state.curve.length'),0);self.assertFalse(self.errors)
    def test_configurable_columns_persist_and_popover_supports_keyboard(self):
        p=self.page
        self.assertEqual(p.locator('#chain thead th[data-field]').count(),10)
        self.assertEqual(p.locator('#chain tr[data-strike="100"] td[data-field="Be"]').inner_text(),'103.25')
        self.assertEqual(p.locator('#chain tr[data-strike="100"] td[data-field="Volume"]').inner_text(),'0')
        self.assertEqual(p.locator('#chain tr[data-strike="120"] td[data-field="Oi"]').inner_text(),'—')
        trigger=p.locator('#columnsTrigger');trigger.click()
        p.locator('#columnOptions input[value="Gamma"]').uncheck()
        self.wait(p,'!meiliWorkbench.inspect().state.columns.includes("Gamma")')
        self.assertEqual(p.locator('#chain thead th[data-field="Gamma"]').count(),0)
        p.locator('#columnsAll').click();self.wait(p,'meiliWorkbench.inspect().state.columns.length === 11')
        self.assertEqual(p.locator('#chain thead th[data-field="Theta"]').count(),1)
        p.keyboard.press('Escape');self.assertFalse(p.locator('#columnPicker').get_attribute('open') is not None)
        self.assertEqual(p.evaluate('document.activeElement.id'),'columnsTrigger')
        p.reload();self.wait(p,'meiliWorkbench.inspect().state?.columns.length === 11')
        self.assertEqual(p.locator('#chain thead th[data-field="Theta"]').count(),1)
        trigger.click();p.locator('#columnHeading').click();p.keyboard.press('Escape');self.assertIsNone(p.locator('#columnPicker').get_attribute('open'));self.assertEqual(p.evaluate('document.activeElement.id'),'columnsTrigger')
        trigger.click();p.locator('#columnsCompact').click();self.wait(p,'meiliWorkbench.inspect().state.columns.length === 0')
        self.assertEqual(p.locator('#chain thead th[data-field]').count(),3)
        self.assertEqual(p.locator('#chain button[data-contract]').count(),18)
        p.locator('#columnsCommon').click();self.wait(p,'meiliWorkbench.inspect().state.columns.length === 7')
        # Rapid changes retain the last complete selection without disabling the focused field.
        p.locator('#columnOptions input[value="Gamma"]').uncheck();p.locator('#columnOptions input[value="Theta"]').check();p.locator('#columnOptions input[value="Vega"]').check()
        self.wait(p,'!meiliWorkbench.inspect().state.columns.includes("Gamma") && meiliWorkbench.inspect().state.columns.includes("Theta") && meiliWorkbench.inspect().state.columns.includes("Vega")')
        self.assertTrue(p.locator('#columnOptions input[value="Vega"]').is_enabled())
        p.locator('#columnsCommon').click();self.wait(p,'meiliWorkbench.inspect().state.columns.length === 7 && meiliWorkbench.inspect().state.columns.includes("Gamma")')
        p.keyboard.press('Escape');p.locator('#rightCall').focus();p.keyboard.press('ArrowRight')
        self.assertEqual(p.locator('#rightPut').get_attribute('aria-selected'),'true')
        self.assertEqual(p.locator('#chain thead th[data-right="Call"]').count(),0)
        self.assertEqual(p.locator('#chain thead th[data-right="Put"]').count(),9)
        p.locator('button.buy[data-contract="Put100"]').click();self.wait(p,'meiliWorkbench.inspect().state.legs.length === 1')
        p.reload();self.wait(p,'meiliWorkbench.inspect().state?.legs.length === 1')
        self.assertEqual(p.locator('#rightPut').get_attribute('aria-selected'),'true')
        p.locator('#rightCall').click();self.assertFalse(self.errors)

    def test_dense_workspace_columns_scroll_and_visual_states(self):
        dll=ROOT/'tests/Meili.Workbench.Host/bin/Release/net10.0/Meili.Workbench.Host.dll'
        process=subprocess.Popen(['dotnet',str(dll),'--dense'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,cwd=ROOT)
        p=self.browser.new_page(viewport=dict(width=1920,height=1080));errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
        try:
            ready,_,_=select.select([process.stdout],[],[],30);self.assertTrue(ready)
            p.goto(json.loads(process.stdout.readline())['url']);self.wait(p,'meiliWorkbench?.inspect().state?.contracts.length === 82')
            self.assertEqual(p.locator('#chain tbody tr[data-strike]').count(),21)
            centered='(()=>{const s=document.querySelector("#chainScroll"),r=document.querySelector("#chain tr.atm"),h=document.querySelector("#chain thead");if(!r)return false;const a=s.getBoundingClientRect(),b=r.getBoundingClientRect(),header=h.getBoundingClientRect().height;return Math.abs(b.top+b.height/2-(a.top+header+(s.clientHeight-header)/2))<3;})()'
            self.wait(p,centered)
            self.assertTrue(p.locator('#chain tr.atm').evaluate('(e)=>e.previousElementSibling.classList.contains("spot-row")'))

            self.assertTrue(p.locator('#draftEmpty').is_visible());self.assertFalse(p.locator('#metrics').is_visible());self.assertFalse(p.locator('#curvePanel').is_visible())
            p.locator('#startSelecting').click();self.assertTrue(p.evaluate('document.activeElement.matches("tr.atm button.buy")'))
            output=os.environ.get('MEILI_RENDER_DIR')
            def capture(name):
                if output:
                    pathlib.Path(output).mkdir(parents=True,exist_ok=True);p.screenshot(path=str(pathlib.Path(output)/(name+'.png')))
            capture('options-empty-1920')
            p.locator('#columnsTrigger').click();self.wait(p,'document.querySelector("#columnPanel").getAnimations().every(a=>a.playState === "finished")');capture('options-columns-1920')
            p.locator('#chainScroll').evaluate('(e)=>e.scrollTop=0')
            p.locator('#columnsAll').click();self.wait(p,'meiliWorkbench.inspect().state.columns.length === 11');p.keyboard.press('Escape')
            self.assertEqual(p.locator('#chainScroll').evaluate('(e)=>e.scrollTop'),0)
            p.locator('#centerAtm').click();self.wait(p,centered)

            p.locator('#rightAll').click()
            self.wait(p,centered)

            p.locator('#chainScroll').evaluate('(e)=>{e.scrollLeft=e.scrollWidth;e.scrollTop=200;}')
            bounds=p.locator('#chainScroll').bounding_box();strike=p.locator('#chain th.strike').bounding_box()
            self.assertGreaterEqual(strike['x'],bounds['x']);self.assertLessEqual(strike['x']+strike['width'],bounds['x']+bounds['width']+1)
            for header in p.locator('#chain thead th').all():self.assertGreaterEqual(header.bounding_box()['y'],bounds['y']-1)
            self.assertGreaterEqual(strike['y'],bounds['y']);self.assertLess(abs(strike['width']-80),2)
            self.assertLessEqual(p.locator('body').evaluate('(e)=>e.scrollWidth'),1920)
            p.locator('#chainScroll').evaluate('(e)=>{e.scrollLeft=0;e.scrollTop=0;}');p.locator('#rightCall').click()
            p.locator('button.buy[data-contract="Call100"]').click();self.wait(p,'meiliWorkbench.inspect().state.legs.length === 1')
            p.locator('button.sell[data-contract="Call105"]').click();self.wait(p,'meiliWorkbench.inspect().state.legs.length === 2')
            p.locator('#columnsTrigger').click();p.locator('#columnsCommon').click();self.wait(p,'meiliWorkbench.inspect().state.columns.length === 7');p.keyboard.press('Escape');capture('options-strategy-1920')
            process.stdin.write('light\n');process.stdin.flush();self.wait(p,'meiliWorkbench.inspect().state.theme.dark === false');capture('options-light-1920')
            p.set_viewport_size(dict(width=480,height=900));p.locator('#columnsTrigger').click()
            popup=p.locator('#columnPanel').bounding_box();self.assertGreaterEqual(popup['x'],0);self.assertLessEqual(popup['x']+popup['width'],480);self.assertLessEqual(popup['y']+popup['height'],900)
            self.assertLessEqual(p.locator('body').evaluate('(e)=>e.scrollWidth'),480);self.assertFalse(errors)
        finally:
            p.close();process.stdin.write('quit\n');process.stdin.flush();process.communicate(timeout=15)
            self.assertEqual(process.returncode,0)

    def test_filters_freeze_headers_and_retain_provenance(self):
        p=self.page
        p.locator('#rightPut').click();self.assertEqual(p.locator('#chain tbody tr[data-strike]').count(),9)
        p.locator('#search').fill('110');self.assertEqual(p.locator('#chain tbody tr[data-strike]').count(),1)
        self.assertEqual(p.locator('#chain button[data-contract]').count(),2)
        self.assertEqual(p.locator('#chain th.strike').evaluate('(e)=>getComputedStyle(e).position'),'sticky')
        self.assertEqual(p.locator('#chain td.strike').first.evaluate('(e)=>getComputedStyle(e).position'),'sticky')
        data=p.evaluate('meiliWorkbench.inspect().state');self.assertEqual(data['source'],'fixture');self.assertEqual(data['delayMinutes'],15)
        self.assertIn('不会下单',p.locator('#draft').inner_text());self.assertTrue(data['asOf'])
        p.locator('#search').fill('');p.locator('#rightCall').click()
    def test_live_theme_language_and_narrow_layout(self):
        p=self.page
        p.locator('button.buy[data-contract="Call100"]').click();self.wait(p,'meiliWorkbench.inspect().state.legs.length === 1')
        for command,expected in [('dark','rgb(31, 30, 29)'),('light','rgb(250, 249, 245)')]:
            self.command(command);self.wait(p,'(dark)=>meiliWorkbench.inspect().state.theme.dark === dark',arg=command=='dark')
            self.assertEqual(p.locator('body').evaluate('(e)=>getComputedStyle(e).backgroundColor'),'rgb(16, 17, 16)' if command=='dark' else expected)
            output=os.environ.get('MEILI_RENDER_DIR')
            if output:
                pathlib.Path(output).mkdir(parents=True,exist_ok=True);p.screenshot(path=str(pathlib.Path(output)/('workbench-'+command+'.png')))
        self.command('en-US');self.wait(p,'meiliWorkbench.inspect().state.language === "en-US"')
        self.assertIn('Paper draft',p.locator('#draft').inner_text())
        p.set_viewport_size(dict(width=480,height=900))
        self.assertGreaterEqual(p.locator('#analysis').bounding_box()['y'],p.locator('#chainArea').bounding_box()['y']+p.locator('#chainArea').bounding_box()['height'])
        self.assertLessEqual(p.locator('body').evaluate('(e)=>e.scrollWidth'),480)
        p.set_viewport_size(dict(width=1920,height=1080));self.command('zh-CN');self.command('dark');self.wait(p,'meiliWorkbench.inspect().state.language === "zh-CN"')
        self.assertFalse(self.errors)

if __name__=='__main__':unittest.main()
