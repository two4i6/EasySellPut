"""Protect discoverability, progressive disclosure and the shared feedback path on both desktops."""
from pathlib import Path
import json,unittest,xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[2]
class UxAuditTests(unittest.TestCase):
    def test_audit_inventory_and_journeys_cover_every_page(self):
        report=(ROOT/'docs/35-全页面UX审计与验收.md').read_text(encoding="utf-8");plan=json.loads((ROOT/'docs/ux/audit-plan.json').read_text(encoding="utf-8"))
        for page in plan['pages']:self.assertIn(page,report)
        self.assertGreaterEqual(len(plan['journeys']),27)
        catalog=json.loads((ROOT/'docs/ux/components-before.json').read_text(encoding="utf-8"));self.assertGreater(len(catalog['components']),500)
    def test_both_desktops_have_visible_paths_and_progressive_controls(self):
        for platform,sub,ext in [('App','Views/Pages','xaml'),('Mac','Views','axaml')]:
            base=ROOT/f'src/Meili.{platform}/{sub}'
            dashboard=(base/f'DashboardPage.{ext}').read_text(encoding="utf-8");self.assertNotIn('Text="{DynamicResource Dash_WelcomeBody}"',dashboard);self.assertIn('OpenChartCommand',dashboard)
            options=(base/f'OptionsPage.{ext}').read_text(encoding="utf-8");self.assertIn('OptionControlsPopover',options)
            for kind in ['LC','SC','LP','SP']:self.assertIn('CommandParameter="'+kind+'"',options)
            alerts=(base/f'AlertsPage.{ext}').read_text(encoding="utf-8");self.assertIn('AdvancedExpanded, Mode=TwoWay',alerts);self.assertIn('UX_RunningOnly',alerts)
            for page in ['Watchlist','Options','News','Alerts','DataSources']:self.assertIn('ux:AppHelp',(base/f'{page}Page.{ext}').read_text(encoding="utf-8"))
            watch=(base/f'WatchlistPage.{ext}').read_text(encoding="utf-8");self.assertIn('OnGroupDraftKeyDown',watch);self.assertIn('HasSelectedRow',watch)
    def test_primary_variants_and_motion_assets_cannot_regress(self):
        for path in (ROOT/'src/Meili.Mac/Views').rglob('*.axaml'):
            self.assertNotIn('Classes="accent"',path.read_text(encoding="utf-8"));self.assertNotIn('Classes="Accent"',path.read_text(encoding="utf-8"))
        for file in ['index.html','workbench.html']:self.assertIn('src="motion.js"',(ROOT/'src/Meili.Shared/WebCharts'/file).read_text(encoding="utf-8"))
        motion=(ROOT/'src/Meili.Shared/WebCharts/motion.js').read_text(encoding="utf-8");self.assertIn('prefers-reduced-motion',motion);self.assertIn('data-reduced-motion',motion)
        self.assertIn('UxInteractionTests',(ROOT/'.github/workflows/ci.yml').read_text(encoding="utf-8"))
if __name__=='__main__':unittest.main()
