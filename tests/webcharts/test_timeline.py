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
    def capture(self,name):
        output=os.environ.get('MEILI_RENDER_DIR')
        if output:
            pathlib.Path(output).mkdir(parents=True,exist_ok=True)
            self.page.screenshot(path=str(pathlib.Path(output)/(name+'.png')))
    def test_timeline_filters_marker_click_metadata_reader_theme_and_compact_layout(self):
        p=self.page
        self.assertEqual(p.evaluate('meiliChart.inspect().eventMarkers.markers().length'),2)
        self.assertEqual(p.evaluate('meiliChart.inspect().series.candles.data().length'),120)
        p.locator('#event-heading').click()
        self.assertEqual(p.locator('#event-list button').count(),4)
        chart_bounds=p.locator('#chart').bounding_box()
        event_bounds=p.locator('#timeline').bounding_box()
        self.assertGreater(chart_bounds['height'],700)
        self.assertGreater(p.evaluate('meiliChart.inspect().chart.panes()[0].getHeight()'),2*p.evaluate('meiliChart.inspect().chart.panes()[1].getHeight()'))
        self.assertGreaterEqual(event_bounds['x'],chart_bounds['x']+chart_bounds['width']-1)
        self.assertLessEqual(event_bounds['width'],301)
        self.assertFalse(p.locator('#event-detail').is_visible())
        self.assertFalse(p.locator('#event-status').is_visible())
        self.assertFalse(p.locator('#event-scope').is_visible())
        self.assertIn('预计',p.locator('#event-list button',has_text='财报').inner_text())
        self.capture('timeline-default-dark')
        # Fit after opening the sidebar so the fixture's early news bar is visible.
        p.locator('#fit').click();p.wait_for_timeout(200)
        # Hover the real chart column: tooltip includes original time, title and provider.
        point=p.evaluate("""()=>{const {chart,series,state}=meiliChart.inspect();const item=state.events.find(e=>e.event.type==='news'&&e.time);return {x:chart.timeScale().timeToCoordinate(item.time),y:series.candles.priceToCoordinate(118.5)}}""")
        bounds=p.locator('#chart').bounding_box()
        p.mouse.move(bounds['x']+point['x'],bounds['y']+point['y']);p.wait_for_timeout(200)
        tooltip=p.locator('#event-tooltip')
        self.assertTrue(tooltip.is_visible())
        self.assertIn('新闻',tooltip.inner_text());self.assertIn('Fixture news <script>literal</script>',tooltip.inner_text())
        self.assertIn('ET',tooltip.inner_text());self.assertIn('Test publisher',tooltip.inner_text())
        self.assertEqual(tooltip.locator('script').count(),0)
        self.capture('event-tooltip-dark')
        p.keyboard.press('Escape');self.assertFalse(tooltip.is_visible())
        # Same-bar events retain their types and count, rather than a bare unexplained number.
        p.evaluate("""()=>{const s=structuredClone(meiliChart.inspect().state);window.originalTimelineState=structuredClone(s);const item=s.events.find(e=>e.event.type==='news'&&e.time);s.events=[...s.events,{...item,event:{...item.event,id:'hover-extra',type:'earnings',title:'Same-bar earnings',confirmation:'estimated'}}];meiliChart.render(s)}""")
        marker=p.evaluate("meiliChart.inspect().eventMarkers.markers().find(m=>m.text.includes('2'))")
        self.assertIn('新闻',marker['text']);self.assertIn('财报',marker['text'])
        p.mouse.move(bounds['x']+point['x']+2,bounds['y']+point['y']);p.wait_for_timeout(150)
        self.assertIn('2 项事件',tooltip.inner_text());self.assertIn('预计',tooltip.inner_text())
        self.capture('event-tooltip-grouped-dark')
        p.evaluate('meiliChart.render(window.originalTimelineState)')
        p.mouse.move(10,10);self.assertFalse(tooltip.is_visible())

        p.locator('#event-info-heading').click()
        self.assertIn('历史',p.locator('#event-scope').inner_text())
        p.locator('#event-info-heading').click()
        p.locator('#event-list button',has_text='Fixture news').click()
        self.assertIn('<script>literal</script>',p.locator('#event-detail').inner_text())
        self.assertIn('Test publisher',p.locator('#event-detail').inner_text())
        self.capture('timeline-selected-dark')
        self.assertFalse(p.locator('.event-metadata p').first.is_visible())
        p.locator('.event-metadata summary').click()
        self.assertIn('本次读取',p.locator('.event-metadata').inner_text())
        p.locator('.event-metadata summary').click()
        p.locator('#event-read').click();p.wait_for_timeout(300)
        self.process.stdin.write('opened\n');self.process.stdin.flush()
        ready,_,_=select.select([self.process.stdout],[],[],10);self.assertTrue(ready)
        opened=json.loads(self.process.stdout.readline());self.assertEqual(opened,[dict(url='https://example.com/news',title='Fixture news <script>literal</script>')])
        p.locator('#event-close').click()
        self.assertFalse(p.locator('#event-detail').is_visible())
        self.assertEqual(p.locator('#event-list button:focus').count(),1)
        p.locator('#event-list button:focus').press('Enter')
        self.assertTrue(p.locator('#event-detail').is_visible())
        p.locator('input[data-type="news"]').uncheck()
        self.assertNotIn('active',p.locator('#event-filters label').filter(has=p.locator('input[data-type="news"]')).get_attribute('class') or '')
        p.locator('input[data-type="news"]').focus();p.keyboard.press('Space')
        self.assertTrue(p.locator('input[data-type="news"]').is_checked())
        self.assertIn('active',p.locator('#event-filters label').filter(has=p.locator('input[data-type="news"]')).get_attribute('class'))
        p.keyboard.press('Space');self.assertFalse(p.locator('input[data-type="news"]').is_checked())
        self.assertEqual(p.locator('#event-list button').count(),2)
        self.assertEqual(p.evaluate('meiliChart.inspect().eventMarkers.markers().length'),1)
        self.assertFalse(p.locator('#event-detail').is_visible())
        p.locator('input[data-type="earnings"]').uncheck()
        p.locator('input[data-type="ex_dividend"]').uncheck()
        self.assertEqual(p.locator('#event-list button').count(),0)
        self.assertIn('暂无匹配事件',p.locator('#event-list').inner_text())
        self.assertEqual(p.evaluate('meiliChart.inspect().eventMarkers.markers().length'),0)
        p.locator('input[data-type="earnings"]').check()
        p.locator('input[data-type="ex_dividend"]').check()
        p.locator('input[data-type="news"]').check()
        p.locator('#event-list button',has_text='财报').click()
        self.assertNotIn('Fixture news',p.locator('#event-detail').inner_text())
        p.locator('#fit').click();p.wait_for_timeout(200)
        # Click the real price pane at the news time; drawing mode is off.
        point=p.evaluate('''()=>{const {chart,series,state}=meiliChart.inspect();const t=state.events.find(e=>e.event.type==='news'&&e.time).time;return {x:chart.timeScale().timeToCoordinate(t),y:series.candles.priceToCoordinate(118.5)}}''')
        bounds=p.locator('#chart').bounding_box();p.mouse.click(bounds['x']+point['x'],bounds['y']+point['y']);p.wait_for_timeout(150)
        self.assertIn('Fixture news',p.locator('#event-detail').inner_text())
        self.assertEqual(p.evaluate("meiliChart.inspect().eventMarkers.markers().filter(m=>m.text.startsWith('› ')).length"),1)
        for command in ['light','en-US']:
            self.process.stdin.write(command+'\n');self.process.stdin.flush()
        self.wait('meiliChart.inspect().state.language === "en-US" && !meiliChart.inspect().state.theme.dark')
        self.assertEqual(p.locator('#event-heading').inner_text(),'Activity')
        point=p.evaluate("""()=>{const {chart,series,state}=meiliChart.inspect();return {x:chart.timeScale().timeToCoordinate(state.events.find(e=>e.event.type==='news'&&e.time).time),y:series.candles.priceToCoordinate(118.5)}}""")
        bounds=p.locator('#chart').bounding_box();p.mouse.move(bounds['x']+point['x'],bounds['y']+point['y']);p.wait_for_timeout(150)
        self.assertTrue(p.locator('#event-tooltip').is_visible());self.assertIn('News',p.locator('#event-tooltip').inner_text())
        self.capture('event-tooltip-light')

        p.set_viewport_size(dict(width=480,height=800));p.wait_for_timeout(150)
        self.assertLessEqual(p.locator('body').evaluate('(e)=>e.scrollWidth'),480)
        self.assertTrue(p.locator('#attribution').is_visible());self.assertFalse(self.errors)
        self.assertGreaterEqual(p.locator('#timeline').bounding_box()['y'],p.locator('#chart').bounding_box()['y']+p.locator('#chart').bounding_box()['height']-1)
        self.assertTrue(p.locator('#event-close').is_visible())
        self.capture('timeline-compact')
        p.locator('#fit').click();p.wait_for_timeout(200)
        point=p.evaluate("""()=>{const {chart,series,state}=meiliChart.inspect();return {x:chart.timeScale().timeToCoordinate(state.events.find(e=>e.event.type==='news'&&e.time).time),y:series.candles.priceToCoordinate(118.5)}}""")
        bounds=p.locator('#chart').bounding_box();p.mouse.move(bounds['x']+point['x'],bounds['y']+point['y']);p.wait_for_timeout(150)
        self.assertTrue(tooltip.is_visible())
        tip=tooltip.bounding_box()
        self.assertGreaterEqual(tip['x'],bounds['x']);self.assertLessEqual(tip['x']+tip['width'],bounds['x']+bounds['width'])
        self.assertGreaterEqual(tip['y'],bounds['y']);self.assertLessEqual(tip['y']+tip['height'],bounds['y']+bounds['height'])
        self.capture('event-tooltip-compact')


if __name__=='__main__':unittest.main()
