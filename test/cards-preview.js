const fs = require('fs');
const OUT = process.argv[2];
const { renderMatchCard } = require('../src/cards/matchCard');
const m = (name, division = 'mens', winner = false) => ({ name, division, imageUrl: null, owner: 'jimmy', winner });
(async () => {
    fs.writeFileSync(`${OUT}/match_singles_title.png`, await renderMatchCard({
        label: 'Singles', matchId: 42, resultType: 'decisive', notes: 'Steel cage stipulation', mode: 'sides',
        banner: { kind: 'title', text: 'World Heavyweight Championship' }, outcome: 'And new champion!',
        sides: [{ name: null, winner: true, members: [m('The Titan', 'mens', true)] }, { name: null, winner: false, members: [m('Crimson Fox')] }]
    }));
    fs.writeFileSync(`${OUT}/match_tag.png`, await renderMatchCard({
        label: 'Tag Team (2v2)', matchId: 43, resultType: 'decisive', mode: 'sides', banner: null, outcome: null,
        sides: [{ name: 'Alpha Bravo', winner: false, members: [m('Alpha'), m('Bravo')] }, { name: 'Char Delta', winner: true, members: [m('Charlie', 'mens', true), m('Delta Dawn Extra Long Name Here', 'mens', true)] }]
    }));
    fs.writeFileSync(`${OUT}/match_ffa5.png`, await renderMatchCard({
        label: '5-Way', matchId: 44, resultType: 'decisive', notes: null, mode: 'ffa', outcome: 'Becomes #1 contender',
        banner: { kind: 'contender', text: '#1 Contender • Women\'s World Championship' },
        entrants: [m('Wendy', 'womens', true), m('Xena', 'womens'), m('Yara', 'womens'), m('Zoe', 'womens'), m('Vee', 'womens')]
    }));
    fs.writeFileSync(`${OUT}/match_draw.png`, await renderMatchCard({
        label: 'Triple Threat', matchId: 45, resultType: 'draw', mode: 'ffa', banner: null, outcome: 'Champion retains',
        entrants: [m('A', 'custom'), m('B', 'custom'), m('C', 'custom')]
    }));
    console.log('done');
})();
// ---- more cards ----
(async () => {
    const { renderProfileCard } = require('../src/cards/profileCard');
    const { renderTeamCard } = require('../src/cards/teamCard');
    const { renderBeltCard } = require('../src/cards/beltCard');
    const summary = { wins: 14, losses: 4, draws: 1, ncs: 0, total: 19, winPct: 77.7, streaks: { current: 4, direction: 'win', longestWin: 7, longestLoss: 2 }, form: ['W', 'W', 'W', 'W', 'L'], byType: { singles: { w: 8, l: 2, d: 0 }, tag2v2: { w: 4, l: 1, d: 1 }, triple_threat: { w: 2, l: 1, d: 0 } } };
    fs.writeFileSync(`${OUT}/profile.png`, await renderProfileCard({ character: { name: 'The Crimson Titan', division: 'mens', imageUrl: null, alignment: 'heel', bio: 'Undefeated in the main event since the dawn of time.', status: 'approved' }, ownerName: 'Jimmy', summary, titlesHeld: ['World Heavyweight Championship', 'United States Championship'], reigns: 3, defenses: 6, teamName: 'Alpha Bravo' }));
    fs.writeFileSync(`${OUT}/profile_new.png`, await renderProfileCard({ character: { name: 'Newbie', division: 'womens', imageUrl: null, alignment: null, bio: null, status: 'approved' }, ownerName: 'Sam', summary: { wins: 0, losses: 0, draws: 0, ncs: 0, total: 0, winPct: 0, streaks: { current: 0, direction: null, longestWin: 0, longestLoss: 0 }, form: [], byType: {} }, titlesHeld: [], reigns: 0, defenses: 0, teamName: null }));
    fs.writeFileSync(`${OUT}/team.png`, await renderTeamCard({ team: { name: 'Alpha Bravo', division: 'mens', status: 'active' }, members: [{ name: 'Alpha', division: 'mens', owner: 'jimmy' }, { name: 'Bravo', division: 'mens', owner: 'sam' }], summary, titlesHeld: ["Men's Tag Team Championship"], reigns: 2, defenses: 3 }));
    fs.writeFileSync(`${OUT}/team4.png`, await renderTeamCard({ team: { name: 'The Four Horsemen Of Chaos', division: 'custom', status: 'active' }, members: ['A', 'B', 'C', 'D'].map((n) => ({ name: n, division: 'custom', owner: 'x' })), summary, titlesHeld: [], reigns: 0, defenses: 0 }));
    fs.writeFileSync(`${OUT}/belt.png`, await renderBeltCard({ title: { name: 'World Heavyweight Championship', division: 'mens', is_tag_title: false }, champion: { name: 'The Crimson Titan', owner: 'jimmy', members: [{ name: 'The Crimson Titan', division: 'mens' }], reignNumber: 2, days: 63, defenses: 4, since: '2026-08-16' }, contender: 'Delta', totalReigns: 5 }));
    fs.writeFileSync(`${OUT}/belt_tag.png`, await renderBeltCard({ title: { name: "Men's Tag Team Championship", division: 'mens', is_tag_title: true }, champion: { name: 'Alpha Bravo', members: [{ name: 'Alpha', division: 'mens' }, { name: 'Bravo', division: 'mens' }], reignNumber: 1, days: 3, defenses: 0, since: '2026-10-15' }, contender: null, totalReigns: 1 }));
    fs.writeFileSync(`${OUT}/belt_vacant.png`, await renderBeltCard({ title: { name: 'Showtime Championship', division: 'custom', is_tag_title: false }, champion: null, contender: 'Xena', totalReigns: 2 }));
    console.log('more done');
})();
