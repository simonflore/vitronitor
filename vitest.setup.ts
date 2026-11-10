import '@testing-library/jest-dom/vitest';
import * as ReactAll from 'react';

// React 19 moved act from react-dom/test-utils to react; testing-library
// checks this flag to decide whether to wrap updates in act().
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Some testing-library paths still reach for a global React under React 19.
(globalThis as Record<string, unknown>).React = ReactAll;
