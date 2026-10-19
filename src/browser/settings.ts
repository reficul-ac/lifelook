import {mountBackupControls} from './backup-controls';
import {element} from './fields';
import type {ScenarioManager} from './scenario-manager';
import type {mountAppearance,AppearanceChoice} from './ui/appearance';

export function mountSettings(root:HTMLElement,manager:ScenarioManager,appearance:ReturnType<typeof mountAppearance>):{dispose():void} {
 const title=element('h2','Settings'),label=element('label','Appearance'),select=element('select');select.setAttribute('aria-label','Appearance');
 for(const choice of ['dark','light','system'] as const){const option=element('option',choice[0]!.toUpperCase()+choice.slice(1));option.value=choice;select.append(option);}select.value=appearance.getChoice();label.append(select);
 const backups=element('div'),about=element('details');about.append(element('summary','About LifeLook'),element('p','LifeLook stores applied financial inputs in this browser. Financial coverage, calculation details and rule sources are available in the forecast.'));
 root.replaceChildren(title,label,backups,about);root.classList.add('workspace-settings');const controls=mountBackupControls(backups,manager);
 select.onchange=()=>appearance.setChoice(select.value as AppearanceChoice);
 return {dispose(){select.onchange=null;controls.dispose();}};
}
