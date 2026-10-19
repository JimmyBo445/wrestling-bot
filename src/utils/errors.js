// Thrown for "you did something wrong" situations. The message is shown
// to the user as-is (privately), and nothing is logged as a crash.
class UserError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UserError';
    }
}

module.exports = { UserError };
