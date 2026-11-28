// How an app version is written for players: "0.1.1" is "0.1.01" (patch padded to two digits).
// Pure text, no interface imports, so both the session layer and the interface can use it.

export interface VersionDisplay {
  /** The large part: "0.1", or the whole label when it is not a version number ("dev"). */
  big: string;
  /** The small part: ".01", ".12", or "" when there is none. */
  small: string;
  /** The whole label as one line of text: "0.1.01". */
  text: string;
}

/** The build's commit hash (the part after "+") is not shown. */
export function versionDisplay(full: string): VersionDisplay {
  const label = full.trim();
  const plus = label.indexOf('+');
  const bare = plus >= 0 ? label.slice(0, plus) : label;
  const m = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(bare);
  if (!m) {
    const big = bare || 'dev';
    return { big, small: '', text: big };
  }
  const big = `${Number(m[1])}.${Number(m[2])}`;
  const small = `.${String(Number(m[3])).padStart(2, '0')}${m[4]}`;
  return { big, small, text: big + small };
}
