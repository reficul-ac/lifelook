import {test,expect} from '@playwright/test';
import {makePlan} from '../helpers/plans';
import {makeScenarioWorkspace} from '../helpers/scenarios';
import {WORKSPACE_STORAGE_KEY} from '../../src/browser/workspace-storage';

test('returns focus to the scenario trigger when tabbing backwards from a scrolling menu',async({page})=>{
 await page.setViewportSize({width:375,height:600});
 const plan=makePlan(),workspace=makeScenarioWorkspace(plan,{
  activeScenarioId:'scenario-25',
  scenarios:Array.from({length:30},(_,index)=>({id:index===0?'master':`scenario-${index}`,name:index===0?'Master':`Scenario ${index}`,plan})),
 });
 await page.addInitScript(({key,workspace})=>localStorage.setItem(key,JSON.stringify(workspace)),{key:WORKSPACE_STORAGE_KEY,workspace});
 await page.goto('/');
 const trigger=page.getByLabel('Scenario',{exact:true}),menu=page.getByRole('menu',{name:'Scenarios'});
 await trigger.click();
 await expect(menu.getByRole('menuitemradio',{name:'Scenario 25',exact:true})).toBeFocused();
 expect(await menu.evaluate(node=>node.scrollHeight>node.clientHeight)).toBe(true);
 await page.keyboard.press('Home');
 await expect(menu.getByRole('menuitemradio').first()).toBeFocused();
 await page.keyboard.press('Shift+Tab');
 await expect(menu).toBeHidden();
 await expect(trigger).toBeFocused();
 await page.keyboard.press('Tab');
 await expect(page.getByRole('button',{name:'Fork scenario',exact:true})).toBeFocused();
});
