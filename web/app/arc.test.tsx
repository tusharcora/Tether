import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { Button } from './components/arc/button/button';
import { Tabs, TabsList, TabsTrigger } from './components/arc/tabs/tabs';

it('renders Arc components under jsdom', () => {
  function Demo() {
    const [v, setV] = useState('a');
    return (
      <>
        <Tabs value={v} onValueChange={setV}>
          <TabsList aria-label="demo">
            <TabsTrigger value="a">A</TabsTrigger>
            <TabsTrigger value="b">B</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button>value {v}</Button>
      </>
    );
  }
  render(<Demo />);
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'B' }));
  fireEvent.click(screen.getByRole('tab', { name: 'B' }));
  expect(screen.getByRole('button', { name: /value/ }).textContent).toContain('value b');
});
