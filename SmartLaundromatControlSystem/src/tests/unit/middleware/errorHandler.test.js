const { errorHandler, notFoundHandler } = require('../../../middleware/errorHandler');
const config = require('../../../config/env');

describe('Error Handler Middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            path: '/api/test',
            method: 'GET'
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        next = jest.fn();
        
        // Clear all mocks before each test
        jest.clearAllMocks();
    });

    describe('errorHandler', () => {
        it('should return detailed error in development', () => {
            const error = new Error('Test error');
            error.statusCode = 400;

            // Mock development environment using jest.spyOn
            jest.spyOn(config, 'IS_DEVELOPMENT', 'get').mockReturnValue(true);
            jest.spyOn(config, 'IS_TEST', 'get').mockReturnValue(false);
            jest.spyOn(config, 'IS_CICD', 'get').mockReturnValue(false);

            errorHandler(error, req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                error: 'Test error',
                stack: expect.any(String)
            }));
        });

        it('should return generic error in production', () => {
            const error = new Error('Internal database error');
            error.statusCode = 500;

            // Mock production environment using jest.spyOn
            jest.spyOn(config, 'IS_PRODUCTION', 'get').mockReturnValue(true);
            jest.spyOn(config, 'IS_DEVELOPMENT', 'get').mockReturnValue(false);
            jest.spyOn(config, 'IS_TEST', 'get').mockReturnValue(false);
            jest.spyOn(config, 'IS_CICD', 'get').mockReturnValue(false);

            errorHandler(error, req, res, next);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: 'Internal Server Error'
            });

            // Should not include stack trace
            const responseData = res.json.mock.calls[0][0];
            expect(responseData.stack).toBeUndefined();
        });

        it('should default to 500 status code if not provided', () => {
            const error = new Error('No status code error');

            jest.spyOn(config, 'IS_TEST', 'get').mockReturnValue(true);

            errorHandler(error, req, res, next);

            expect(res.status).toHaveBeenCalledWith(500);
        });

        it('should handle 401 Unauthorized', () => {
            const error = new Error('Unauthorized');
            error.statusCode = 401;

            // Mock production
            jest.spyOn(config, 'IS_PRODUCTION', 'get').mockReturnValue(true);
            jest.spyOn(config, 'IS_DEVELOPMENT', 'get').mockReturnValue(false);
            jest.spyOn(config, 'IS_TEST', 'get').mockReturnValue(false);
            jest.spyOn(config, 'IS_CICD', 'get').mockReturnValue(false);

            errorHandler(error, req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: 'Unauthorized'
            });
        });

        it('should handle 429 Too Many Requests', () => {
            const error = new Error('Rate limit exceeded');
            error.statusCode = 429;

            // Mock production
            jest.spyOn(config, 'IS_PRODUCTION', 'get').mockReturnValue(true);
            jest.spyOn(config, 'IS_DEVELOPMENT', 'get').mockReturnValue(false);
            jest.spyOn(config, 'IS_TEST', 'get').mockReturnValue(false);
            jest.spyOn(config, 'IS_CICD', 'get').mockReturnValue(false);

            errorHandler(error, req, res, next);

            expect(res.status).toHaveBeenCalledWith(429);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: 'Too Many Requests'
            });
        });
    });

    describe('notFoundHandler', () => {
        it('should create 404 error and pass to next', () => {
            notFoundHandler(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.objectContaining({
                message: 'Route not found: GET /api/test',
                statusCode: 404
            }));
        });

        it('should include request method and path in error message', () => {
            req.method = 'POST';
            req.path = '/api/unknown';

            notFoundHandler(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.objectContaining({
                message: 'Route not found: POST /api/unknown'
            }));
        });
    });
});
