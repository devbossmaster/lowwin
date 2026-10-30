import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {StaffPasswordField} from '../src/components/staff-password-field';

describe('staff password visibility control',()=>{
 it.each(['current-password','new-password'] as const)('starts masked and preserves %s credential semantics',autoComplete=>{
  const html=renderToStaticMarkup(createElement(StaffPasswordField,{autoComplete}));
  expect(html).toContain('type="password"');expect(html).toContain(`autoComplete="${autoComplete}"`);expect(html).toContain('name="password"');expect(html).toContain('minLength="12"');
  expect(html).toContain('type="button"');expect(html).toContain('aria-label="Show password"');expect(html).toContain('aria-pressed="false"');
  const id=/\bid="([^"]+)"/.exec(html)?.[1];expect(id).toBeTruthy();expect(html).toContain(`aria-controls="${id}"`);
 });
});
