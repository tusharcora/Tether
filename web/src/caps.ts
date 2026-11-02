import { createContext, useContext } from 'react';

/** Spending caps (Settings, GET /api/health): on, $ caps show as limits; off (the default), runs only show what they cost. */
export const Caps = createContext(false);
export const useCaps = () => useContext(Caps);
/** Under a $ cap field while caps are off: the value is kept for when they are turned on. */
export const CAPS_HINT = 'Only used when Spending caps is on (Settings).';
