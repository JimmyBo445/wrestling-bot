const fs = require('fs');
const OUT = process.argv[2];
const { renderShowCard } = require('../src/cards/showCard');
const { renderProfileCard } = require('../src/cards/profileCard');
const m = (name, division = 'mens') => ({ name, division, imageUrl: null, owner: name === 'TBD' ? null : ['jimmy', 'sam', 'alex', 'kayla'][name.length % 4] });
const sides = (a, b, ta = null, tb = null) => ({ mode: 'sides', sides: [{ teamName: ta, members: a.map((n) => m(n)) }, { teamName: tb, members: b.map((n) => m(n)) }] });
(async () => {
    const matches = [
        { number: 1, label: 'Singles', stipulation: null, title: null, ...sides(['Crimson Fox'], ['Bull']) },
        { number: 2, label: 'Tag Team (2v2)', stipulation: 'No DQ', title: null, ...sides(['Wolf', 'Hawk'], ['Jackal', 'Raven'], 'The Packmen', null) },
        { number: 3, label: 'Triple Threat', stipulation: 'Rematch', title: null, mode: 'ffa', entrants: [m('Alpha'), m('Bravo'), m('Charlie')] },
        { number: 4, label: '6-Man Tag', stipulation: null, title: null, ...sides(['A1', 'A2', 'A3'], ['B1', 'B2', 'B3']) },
        { number: 5, label: 'Fatal 4-Way', stipulation: null, title: 'Intercontinental Championship', mode: 'ffa', entrants: [m('W'), m('X'), m('Y'), m('Z')] },
        { number: 6, label: '8-Man Tag', stipulation: null, title: null, ...sides(['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']) },
        { number: 7, label: '5-Way', stipulation: null, title: null, mode: 'ffa', entrants: ['1', '2', '3', '4', '5'].map((n) => m('Wrestler ' + n)) },
        { number: 8, label: 'Tag Team (2v2)', stipulation: null, title: "Men's Tag Team Championship", ...sides(['Alpha', 'Bravo'], ['Charlie With A Very Long Name', 'Delta'], 'Alpha Bravo', 'Char Delta') },
        { number: 9, label: 'Singles', stipulation: null, title: null, ...sides(['The Titan'], ['TBD']) },
        { number: 10, label: 'Singles', stipulation: 'Main Event', title: 'World Heavyweight Championship', ...sides(['The Crimson Titan'], ['Iron Giant']) }
    ];
    fs.writeFileSync(`${OUT}/raw_full.png`, await renderShowCard({ serverName: 'Brawl Of Legends', brand: 'raw', division: 'mens', name: 'Monday Night Mayhem', matches }));
    fs.writeFileSync(`${OUT}/sd_short.png`, await renderShowCard({ serverName: 'Brawl Of Legends', brand: 'smackdown', division: 'womens', name: null, matches: matches.slice(0, 3).map((x, i) => ({ ...x, number: i + 1 })) }));
    fs.writeFileSync(`${OUT}/sd_empty.png`, await renderShowCard({ brand: 'smackdown', division: 'custom_womens', name: 'Friday Fights', matches: [] }));
    const summary = { wins: 14, losses: 4, draws: 1, ncs: 0, total: 19, winPct: 77.7, streaks: { current: 4, direction: 'win', longestWin: 7, longestLoss: 2 }, form: ['W', 'W', 'W', 'W', 'L'], byType: { singles: { w: 8, l: 2, d: 0 } } };
    fs.writeFileSync(`${OUT}/profile_sig.png`, await renderProfileCard({ serverName: 'Brawl Of Legends', character: { name: 'The Crimson Titan', division: 'mens', imageUrl: null, alignment: 'heel', bio: 'Undefeated in the main event.', finisher: 'Crimson Crusher', entranceTheme: 'Thunder Road (Remix)', status: 'approved' }, ownerName: 'Jimmy', summary, titlesHeld: ['World Heavyweight Championship'], reigns: 3, defenses: 6, teamName: null }));
    fs.writeFileSync(`${OUT}/profile_fin_only.png`, await renderProfileCard({ character: { name: 'Wendy', division: 'womens', imageUrl: null, alignment: 'face', bio: null, finisher: 'Wendy Wallop', entranceTheme: null, status: 'approved' }, ownerName: 'Sam', summary, titlesHeld: [], reigns: 0, defenses: 0, teamName: null }));
    console.log('ok');
})();

(async () => {
    const { renderMatchCard } = require('../src/cards/matchCard');
    const { renderTeamCard } = require('../src/cards/teamCard');
    const { renderBeltCard } = require('../src/cards/beltCard');
    const mm = (name) => ({ name, division: 'mens', imageUrl: null, owner: 'jimmy' });
    fs.writeFileSync(`${OUT}/match_srv.png`, await renderMatchCard({ serverName: 'Brawl Of Legends', label: 'Singles', matchId: 42, resultType: 'decisive', notes: null, mode: 'sides', banner: { kind: 'title', text: 'Championship Match • World Heavyweight Championship' }, outcome: 'And new champion!', sides: [{ name: null, winner: true, members: [{ ...mm('The Titan'), winner: true }] }, { name: null, winner: false, members: [mm('Crimson Fox')] }] }));
    const summary = { wins: 14, losses: 4, draws: 1, ncs: 0, total: 19, winPct: 77.7, streaks: { current: 4, direction: 'win', longestWin: 7, longestLoss: 2 }, form: ['W', 'W', 'W', 'W', 'L'], byType: { singles: { w: 8, l: 2, d: 0 } } };
    fs.writeFileSync(`${OUT}/team_srv.png`, await renderTeamCard({ serverName: 'Brawl Of Legends', team: { name: 'Alpha Bravo', division: 'mens', status: 'active' }, members: [mm('Alpha'), mm('Bravo')], summary, titlesHeld: [], reigns: 0, defenses: 0 }));
    fs.writeFileSync(`${OUT}/belt_srv.png`, await renderBeltCard({ serverName: 'Brawl Of Legends', title: { name: 'World Heavyweight Championship', division: 'mens', is_tag_title: false }, champion: { name: 'The Crimson Titan', owner: 'jimmy', members: [mm('The Crimson Titan')], reignNumber: 2, days: 63, defenses: 4, since: '2026-08-16' }, contender: 'Delta', totalReigns: 5 }));
    console.log('srv ok');
})();
