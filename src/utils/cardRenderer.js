// Kept as a single import point; the real drawing code lives in src/cards/.
const { renderMatchCard } = require('../cards/matchCard');
const { renderProfileCard } = require('../cards/profileCard');
const { renderTeamCard } = require('../cards/teamCard');
const { renderBeltCard } = require('../cards/beltCard');

module.exports = { renderMatchCard, renderProfileCard, renderTeamCard, renderBeltCard };
