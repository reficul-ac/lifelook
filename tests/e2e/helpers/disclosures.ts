import type {Locator} from '@playwright/test';
/** Open the existing visible summary path before interacting with nested report content. */
export async function revealDetails(locator:Locator):Promise<void>{
  const page=locator.page(),forecast=page.getByRole('button',{name:'Forecast',exact:true});if(await forecast.isVisible())await forecast.click();
  const ancestors=locator.locator('xpath=ancestor::details');
  for(let index=0;index<await ancestors.count();index++){const details=ancestors.nth(index);if(await details.getAttribute('open')===null)await details.locator(':scope > summary').click();}
}
