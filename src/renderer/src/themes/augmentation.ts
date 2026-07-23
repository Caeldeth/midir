// Module augmentation for the extended palette keys used by the four
// shared themes. The website's themes (the canonical source) are plain
// JS so they accept arbitrary keys; in TS we have to teach MUI's types
// about them or every theme file produces type errors.
//
// This file has no runtime exports — it exists only to extend the
// '@mui/material/styles' module. As long as it's included in the
// renderer's tsconfig (it is, via src/renderer/src/**/*), the
// augmentation is in scope everywhere.

declare module '@mui/material/styles' {
  interface TypeBackground {
    /** Same as `default` — kept for parity with sibling repos that read it. */
    gray: string
    /** Slightly darker than `paper` — for nested surfaces. */
    paperMedium: string
    /** Slightly lighter than `paper` — for hover states / panels. */
    paperLight: string
    /** Much darker than `paper` — for dialog scrims, scrollbar tracks. */
    paperDark: string
    /** Light surface for table rows / data rows. */
    tableLight: string
    /** Dark surface for alternating table rows. */
    tableDark: string
    /** Light border for table cells / dividers. */
    tableBorderL: string
    /** Heavy border for table boundaries. */
    tableBorderD: string
    /** Scrollbar thumb (resting). */
    scrollbarDark: string
    /** Scrollbar thumb (hover). */
    scrollbarLight: string
  }

  interface TypeText {
    /** Headline accent — used by hero text, CircularProgress, etc. */
    headline: string
    /** Resting link color. */
    link: string
    /** Hovered link color. */
    linkHover: string
    /** Visited link color. */
    visited: string
    /** Text color used inside contained buttons. */
    button: string
    /** Very dark text for use on light backgrounds in mostly-dark themes. */
    dark: string
  }
}

// Empty export to keep this a module rather than a global script.
export {}
