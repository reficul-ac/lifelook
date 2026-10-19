import type {Locator} from '@playwright/test';
import {revealLocator} from './workspace';
/** Follow the visible Forecast surface and native disclosure path. */
export async function revealDetails(locator:Locator):Promise<void>{
  const forecast=locator.page().getByRole('button',{name:'Forecast',exact:true});
  if(await forecast.isVisible())await forecast.click();
  await revealLocator(locator);
}
