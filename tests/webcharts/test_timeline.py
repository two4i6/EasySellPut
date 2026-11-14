#!/usr/bin/env python3
"""Real Chromium -> production private C# channel and timeline, with test-only providers."""
import json
import os
import pathlib
import select
import subprocess
import time
import unittest
from playwright.sync_api import sync_playwright

ROOT=pathlib.Path(__file__).resolve().parents[2]

class TimelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        dll=ROOT/'tests/Meili.Workbench.Host/bin/Release/net10.0/Meili.Workbench.Host.dll'
        cls.process=subprocess.Popen(['dotnet',str(dll),'--chart'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,cwd=ROOT)
        ready,_,_=select.select([cls.process.stdout],[],[],45)
        if not ready: cls.process.kill();raise RuntimeError('Timeline fixture host did not start')
        line=cls.process.stdout.readline()
        if not line: raise RuntimeError(cls.process.stderr.read())
        cls.url=json.loads(line)['url'];cls.errors=[]
        cls.playwright=sync_playwright().start()
        executable=os.environ.get('MEILI_CHROMIUM')
        cls.browser=cls.playwright.chromium.launch(headless=True,**({'executable_path':executable} if executable else {}))
        cls.page=cls.browser.new_page(viewport=dict(width=1280,height=900));cls.page.on('pageerror',lambda e:cls.errors.append(str(e)))
        cls.page.goto(cls.url);cls.wait('window.meiliChart?.inspect().state?.events.length === 4')
    @classmethod
    def wait(cls,expression):
        deadline=time.monotonic()+30
        while not cls.page.evaluate('()=>('+expression+')'):
            if time.monotonic()>deadline: raise TimeoutError(expression)
            cls.page.wait_for_timeout(100)
    @classmethod
    def tearDownClass(cls):
        cls.browser.close();cls.playwright.stop();cls.process.stdin.write('quit\n');cls.process.stdin.flush();cls.process.communicate(timeout=15)
        if cls.process.returncode: raise RuntimeError('Timeline host exit '+str(cls.process.returncode))
    def test_timeline_filters_marker_click_metadata_reader_theme_and_compact_layout(self):
        p=self.page
        self.assertEqual(p.evaluate('meiliChart.inspect().eventMarkers.markers().length'),2)
        self.assertEqual(p.evaluate('meiliChart.inspect().series.candles.data().length'),120)
        p.locator('#event-heading').click()
        self.assertEqual(p.locator('#event-list button').count(),4)
        p.locator('#event-list button',has_text='Fixture news').click()
        self.assertIn('<script>literal</script>',p.locator('#event-detail').inner_text())
        self.assertIn('Test publisher',p.locator('#event-detail').inner_text())
        p.locator('#event-detail button').click();p.wait_for_timeout(300)
        self.process.stdin.write('opened\n');self.process.stdin.flush()
        ready,_,_=select.select([self.process.stdout],[],[],10);self.assertTrue(ready)
        opened=json.loads(self.process.stdout.readline());self.assertEqual(opened,[dict(url='https://example.com/news',title='Fixture news <script>literal</script>')])
        p.locator('input[data-type="news"]').uncheck()
        self.assertEqual(p.locator('#event-list button').count(),2)
        self.assertEqual(p.evaluate('meiliChart.inspect().eventMarkers.markers().length'),1)
        p.locator('input[data-type="news"]').check()
        p.locator('#event-list button',has_text='财报').click()
        self.assertNotIn('Fixture news',p.locator('#event-detail').inner_text())
        p.locator('#fit').click();p.wait_for_timeout(200)
        # Click the real price pane at the news time; drawing mode is off.
        point=p.evaluate('''()=>{const {chart,series,state}=meiliChart.inspect();const t=state.events.find(e=>e.event.type==='news'&&e.time).time;return {x:chart.timeScale().timeToCoordinate(t),y:series.candles.priceToCoordinate(118.5)}}''')
        bounds=p.locator('#chart').bounding_box();p.mouse.click(bounds['x']+point['x'],bounds['y']+point['y']);p.wait_for_timeout(150)
        self.assertIn('Fixture news',p.locator('#event-detail').inner_text())
        for command in ['light','en-US']:
            self.process.stdin.write(command+'\n');self.process.stdin.flush()
        self.wait('meiliChart.inspect().state.language === "en-US" && !meiliChart.inspect().state.theme.dark')
        self.assertEqual(p.locator('#event-heading').inner_text(),'Event timeline')
        p.set_viewport_size(dict(width=480,height=800));p.wait_for_timeout(150)
        self.assertLessEqual(p.locator('body').evaluate('(e)=>e.scrollWidth'),480)
        self.assertTrue(p.locator('#attribution').is_visible());self.assertFalse(self.errors)
        output=os.environ.get('MEILI_RENDER_DIR')
        if output:
            pathlib.Path(output).mkdir(parents=True,exist_ok=True);p.screenshot(path=str(pathlib.Path(output)/'timeline-compact.png'))

if __name__=='__main__':unittest.main()
