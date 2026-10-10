import { describe, expect, it } from 'vitest';

import {
  pairsWith,
  parseCatalogClass,
  requiredChoices,
  toScheduledFromCatalog,
  type CatalogSection,
} from './asuCatalog';

/**
 * Shaped like entries of ASU's `search/classes` response for CHM 113 in Fall
 * 2026, trimmed to the fields Verdct reads. The Tempe lecture carries an
 * association number and its recitations and labs carry none, which is how
 * the live data looked when this was written.
 */
function raw(clas: Record<string, unknown>, outer: Record<string, unknown> = {}): unknown {
  return {
    CLAS: {
      STRM: '2267',
      CRSEID: '103766',
      CRSEOFFERNBR: '1',
      SUBJECT: 'CHM',
      CATALOGNBR: '113',
      TITLE: 'General Chemistry I',
      SESSIONCODE: 'C',
      MEETINGDATES: [['8/20/2026', '12/4/2026']],
      ...clas,
    },
    ...outer,
  };
}

const LECTURE = raw(
  {
    CLASSNBR: '60104',
    CLASSTYPE: 'E',
    ASSOCIATEDCLASS: '1036',
    DESCR2: 'Lecture',
    OPTIONALSECTION: 'N',
    STARTTIMES: ['9:00 AM'],
    ENDTIMES: ['10:15 AM'],
    INSTRUCTORSLIST: ['Ron Briggs'],
    UNITSMINIMUM: '4',
    UNITSMAXIMUM: '4',
  },
  {
    DAYLIST: ['T Th'],
    LOCATIONBUILDING: [{ NAME: 'Tempe - PSH150' }],
    seatInfo: { ENRL_CAP: 181, ENRL_TOT: 178 },
  },
);

function companion(overrides: Record<string, unknown>, outer: Record<string, unknown> = {}): unknown {
  return raw(
    {
      CLASSTYPE: 'N',
      ASSOCIATEDCLASS: '',
      OPTIONALSECTION: '',
      UNITSMINIMUM: '0',
      UNITSMAXIMUM: '0',
      ...overrides,
    },
    { DAYLIST: ['T'], ...outer },
  );
}

function parsed(value: unknown): CatalogSection {
  const section = parseCatalogClass(value);
  if (!section) throw new Error('fixture did not parse');
  return section;
}

describe('parseCatalogClass', () => {
  it('reads a lecture as an enrollment section with its association', () => {
    expect(parsed(LECTURE)).toMatchObject({
      classNumber: '60104',
      term: '2267',
      catalogCourseId: '103766',
      offerNumber: '1',
      association: '1036',
      component: 'Lecture',
      enrollment: true,
      optional: false,
      courseId: 'CHM 113',
      instructors: ['Ron Briggs'],
      meetings: [{ days: ['Tue', 'Thu'], startMinutes: 540, endMinutes: 615 }],
      location: 'Tempe - PSH150',
      dates: { start: '8/20', end: '12/4', sessionCode: 'C' },
      units: 4,
      unitsMax: null,
      seatsOpen: 3,
      seatsTotal: 181,
    });
  });

  it('treats a blank or zero association as none', () => {
    expect(parsed(companion({ CLASSNBR: '60106', ASSOCIATEDCLASS: '' })).association).toBeNull();
    expect(parsed(companion({ CLASSNBR: '60106', ASSOCIATEDCLASS: '0' })).association).toBeNull();
  });

  it('drops the honorific the API puts on some names but the results page does not', () => {
    const section = parsed(
      companion({ CLASSNBR: '60106', INSTRUCTORSLIST: ['Mrs Stacy Sendler', 'Dr. Ana Ruiz', 'Staff'] }),
    );
    expect(section.instructors).toEqual(['Stacy Sendler', 'Ana Ruiz']);
  });

  it('reads a location sent as a JSON string', () => {
    const section = parsed(
      companion(
        { CLASSNBR: '60106' },
        { LOCATIONBUILDING: JSON.stringify([{ NAME: 'Tempe - NOBLE105' }]) },
      ),
    );
    expect(section.location).toBe('Tempe - NOBLE105');
  });

  it('keeps every meeting of a section that meets at different times', () => {
    const section = parsed(
      companion(
        { CLASSNBR: '60100', STARTTIMES: ['10:00 AM', '1:30 PM'], ENDTIMES: ['10:50 AM', '3:20 PM'] },
        { DAYLIST: ['M W', 'F'] },
      ),
    );
    expect(section.meetings).toEqual([
      { days: ['Mon', 'Wed'], startMinutes: 600, endMinutes: 650 },
      { days: ['Fri'], startMinutes: 810, endMinutes: 920 },
    ]);
  });

  it('gives an asynchronous section no meetings rather than a broken one', () => {
    const section = parsed(
      companion({ CLASSNBR: '85227', STARTTIMES: [null], ENDTIMES: [null] }, { DAYLIST: [''] }),
    );
    expect(section.meetings).toEqual([]);
  });

  it('refuses a record missing what pairing depends on', () => {
    expect(parseCatalogClass(raw({ CLASSNBR: '60104', CLASSTYPE: '' }))).toBeNull();
    expect(parseCatalogClass(raw({ CLASSNBR: '', CLASSTYPE: 'E' }))).toBeNull();
    expect(parseCatalogClass({})).toBeNull();
    expect(parseCatalogClass(null)).toBeNull();
  });
});

describe('pairsWith', () => {
  const lecture = parsed(LECTURE);

  it('pairs a section with no association with any lecture in its offering', () => {
    expect(pairsWith(lecture, parsed(companion({ CLASSNBR: '60106' })))).toBe(true);
  });

  it("pairs a section carrying the lecture's own association", () => {
    expect(pairsWith(lecture, parsed(companion({ CLASSNBR: '60106', ASSOCIATEDCLASS: '1036' })))).toBe(
      true,
    );
  });

  it("refuses a section tied to a different lecture's association", () => {
    expect(pairsWith(lecture, parsed(companion({ CLASSNBR: '60106', ASSOCIATEDCLASS: '3001' })))).toBe(
      false,
    );
  });

  it('refuses a section from another offering of the course, such as another campus', () => {
    expect(pairsWith(lecture, parsed(companion({ CLASSNBR: '90192', CRSEOFFERNBR: '4' })))).toBe(false);
  });

  it('refuses another lecture, which is enrolled in on its own', () => {
    expect(pairsWith(lecture, parsed(raw({ CLASSNBR: '60105', CLASSTYPE: 'E', ASSOCIATEDCLASS: '1036' })))).toBe(
      false,
    );
  });

  it('refuses the same section in another term', () => {
    expect(pairsWith(lecture, parsed(companion({ CLASSNBR: '60106', STRM: '2271' })))).toBe(false);
  });
});

describe('requiredChoices', () => {
  const lecture = parsed(LECTURE);
  const recitation = (classNumber: string, day: string, start: string, end: string) =>
    parsed(
      companion(
        { CLASSNBR: classNumber, DESCR2: 'Recitation', STARTTIMES: [start], ENDTIMES: [end] },
        { DAYLIST: [day] },
      ),
    );
  const lab = (classNumber: string) =>
    parsed(
      companion(
        { CLASSNBR: classNumber, DESCR2: 'Laboratory', STARTTIMES: ['10:00 AM'], ENDTIMES: ['11:50 AM'] },
        { DAYLIST: ['Th'] },
      ),
    );

  it('asks for one of each component, each in the order it meets across the week', () => {
    const choices = requiredChoices(lecture, [
      lecture,
      recitation('60108', 'W', '8:00 AM', '8:50 AM'),
      lab('60100'),
      recitation('60106', 'T', '9:00 AM', '9:50 AM'),
      recitation('60107', 'T', '8:00 AM', '8:50 AM'),
    ]);

    expect(choices.map((choice) => choice.component)).toEqual(['Laboratory', 'Recitation']);
    expect(choices[1].options.map((option) => option.classNumber)).toEqual(['60107', '60106', '60108']);
  });

  it('asks for nothing when a lecture has no recitation or lab', () => {
    expect(requiredChoices(lecture, [lecture])).toEqual([]);
  });

  it('leaves out components PeopleSoft marks optional', () => {
    const optional = parsed(companion({ CLASSNBR: '60109', DESCR2: 'Recitation', OPTIONALSECTION: 'Y' }));
    expect(requiredChoices(lecture, [optional])).toEqual([]);
  });

  it('leaves out sections that belong to a different lecture', () => {
    const elsewhere = parsed(companion({ CLASSNBR: '90192', DESCR2: 'Recitation', ASSOCIATEDCLASS: '3001' }));
    expect(requiredChoices(lecture, [elsewhere])).toEqual([]);
  });
});

describe('toScheduledFromCatalog', () => {
  it('keeps the component, so the schedule can say which block is the recitation', () => {
    const scheduled = toScheduledFromCatalog(parsed(companion({ CLASSNBR: '60106', DESCR2: 'Recitation' })));
    expect(scheduled.component).toBe('Recitation');
    expect(scheduled.courseId).toBe('CHM 113');
  });
});
