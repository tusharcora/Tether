/** Wrap text that is data (user answers, free text, task, vault notes) so an agent reads it as information, never as instructions. */
export function fence(tag: string, text: string): string {
  // strip until stable: removing a tag can join the pieces around it into a new one (`<</x>/x>` -> `</x>`)
  const re = new RegExp(`</?\\s*${tag}\\s*>`, 'gi');
  let safe = text;
  for (let prev = ''; prev !== safe; ) {
    prev = safe;
    safe = safe.replace(re, '');
  }
  return `<${tag}>\n${safe}\n</${tag}>`;
}
