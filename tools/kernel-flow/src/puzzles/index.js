import m_p01 from './p01.js';
import m_p02 from './p02.js';
import m_p03 from './p03.js';
import m_p04 from './p04.js';
import m_p05 from './p05.js';
import m_p06 from './p06.js';
import m_p07 from './p07.js';
import m_p08 from './p08.js';
import m_p11 from './p11.js';
import m_p12 from './p12.js';
import m_p13 from './p13.js';
import m_p13b from './p13b.js';
import m_p14 from './p14.js';
import m_p14b from './p14b.js';
import m_p15 from './p15.js';
import m_p16 from './p16.js';
import m_p16s from './p16s.js';
import m_p16t from './p16t.js';
import m_p24 from './p24.js';
import m_p25 from './p25.js';
import m_p25b from './p25b.js';
import m_p26 from './p26.js';
import m_p26b from './p26b.js';
import m_p27 from './p27.js';
import m_p27b from './p27b.js';

// In curriculum order. Pages still marked `stub` are hidden.
export const ALL = [m_p01, m_p02, m_p03, m_p04, m_p05, m_p06, m_p07, m_p08, m_p11, m_p12, m_p13, m_p13b, m_p14, m_p14b, m_p15, m_p16, m_p16s, m_p16t, m_p24, m_p25, m_p25b, m_p26, m_p26b, m_p27, m_p27b];
export const PUZZLES = ALL.filter(p => !p.stub);
