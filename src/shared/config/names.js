// Soldier names per country (fictional). Surnames are used for rank-and-file
// soldiers ("PFC Hale"); named officers get a first name too.
import { FACTION } from '../constants.js';

export const FIRST_NAMES = {
  [FACTION.ALDMARK]: ['Edmund', 'Mara', 'Alistair', 'Helena', 'Rowan', 'Tobias', 'Evelyn', 'Gareth', 'Imogen', 'Callum', 'Ada', 'Rhys', 'Beatrix', 'Owen', 'Lydia', 'Hugh', 'Nell', 'Silas', 'Maren', 'Duncan'],
  [FACTION.KARSA]: ['Dmitri', 'Irina', 'Oleg', 'Katya', 'Radomir', 'Vesna', 'Bogdan', 'Anya', 'Yuri', 'Zora', 'Pavel', 'Mila', 'Stanislav', 'Lada', 'Gorun', 'Tamar', 'Ilya', 'Dasha', 'Viktor', 'Nadia'],
  [FACTION.SERAVIA]: ['Matteo', 'Lucia', 'Andres', 'Sofia', 'Teodor', 'Elena', 'Marco', 'Ines', 'Dario', 'Chiara', 'Nikos', 'Alba', 'Emilio', 'Rosa', 'Luca', 'Valeria', 'Tomas', 'Livia', 'Sandro', 'Mirela'],
};

export const SURNAMES = {
  [FACTION.ALDMARK]: ['Hale', 'Ashcombe', 'Whitlock', 'Pembury', 'Thorne', 'Aldridge', 'Kerr', 'Fairholm', 'Dunmore', 'Blackwood', 'Harrow', 'Lindqvist', 'Carrow', 'Mercer', 'Ellery', 'Vane', 'Miller', 'Brooks', 'Larsen', 'Quinn', 'Walsh', 'Fischer', 'Novak', 'Adler'],
  [FACTION.KARSA]: ['Karvanov', 'Drozdek', 'Voronin', 'Strelko', 'Bazhenov', 'Kolar', 'Morozov', 'Ruska', 'Tarkov', 'Zelenko', 'Grachev', 'Volkan', 'Sorokin', 'Hrabal', 'Dubrava', 'Kraus', 'Orlov', 'Stahl', 'Varga', 'Radek', 'Ivanek', 'Zoric', 'Sokol', 'Grom'],
  [FACTION.SERAVIA]: ['Serrano', 'Castellan', 'Moretti', 'Delvaux', 'Arenas', 'Marchetti', 'Ruiz', 'Ferrante', 'Santoro', 'Lucen', 'Bastida', 'Iveri', 'Montero', 'Costa', 'Duarte', 'Reyes', 'Moreau', 'Haddad', 'Navarro', 'Belli', 'Corvo', 'Pardo', 'Vidal', 'Rinaldi'],
};

export function surnameFor(faction, n) {
  const list = SURNAMES[faction] || SURNAMES[FACTION.ALDMARK];
  return list[Math.abs(n | 0) % list.length];
}

export function fullNameFor(faction, n) {
  const first = FIRST_NAMES[faction] || FIRST_NAMES[FACTION.ALDMARK];
  return `${first[Math.abs(n | 0) % first.length]} ${surnameFor(faction, Math.floor(n / 7) + n * 3)}`;
}
