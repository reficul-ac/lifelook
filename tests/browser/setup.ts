import '@testing-library/jest-dom/vitest';

import {afterEach} from 'vitest';
import {unmountApp} from '../../src/browser/main';
afterEach(async()=>{
  for(const root of document.querySelectorAll<HTMLElement>('.workspace'))unmountApp(root);
  document.body.replaceChildren();
  await Promise.resolve();
});
