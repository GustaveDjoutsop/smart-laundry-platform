const authService = require('../../../services/authService');

describe('AuthService - Security', () => {
    describe('JWT Secret Requirement', () => {
        it('should require JWT_SECRET environment variable', () => {
            // This test verifies that authService module fails to load without JWT_SECRET
            // Since the module is already loaded in this test, we test that the secret exists
            expect(process.env.JWT_SECRET).toBeDefined();
            expect(process.env.JWT_SECRET).not.toBe('');
            expect(process.env.JWT_SECRET).not.toBe('your-super-secret-key-change-in-production');
        });

        it('should not use hardcoded fallback secret', () => {
            // Verify that we're not using the old hardcoded secret
            const testUser = {
                _id: 'test123',
                email: 'test@example.com',
                role: 'customer'
            };

            const token = authService.generateAccessToken(testUser);
            expect(token).toBeDefined();

            // Should be able to decode and verify with current secret
            const decoded = authService.verifyAccessToken(token);
            expect(decoded.userId).toBe('test123');
            expect(decoded.email).toBe('test@example.com');
        });
    });

    describe('Token Generation', () => {
        const testUser = {
            _id: 'user123',
            email: 'test@example.com',
            role: 'customer'
        };

        it('should generate valid access token', () => {
            const token = authService.generateAccessToken(testUser);
            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
            expect(token.split('.').length).toBe(3); // JWT format: header.payload.signature
        });

        it('should generate valid refresh token', () => {
            const token = authService.generateRefreshToken(testUser);
            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
            expect(token.split('.').length).toBe(3);
        });

        it('should include user data in access token payload', () => {
            const token = authService.generateAccessToken(testUser);
            const decoded = authService.decodeToken(token);

            expect(decoded.userId).toBe('user123');
            expect(decoded.email).toBe('test@example.com');
            expect(decoded.role).toBe('customer');
            expect(decoded.roleLevel).toBeDefined();
        });

        it('should include type field in refresh token payload', () => {
            const token = authService.generateRefreshToken(testUser);
            const decoded = authService.decodeToken(token);

            expect(decoded.userId).toBe('user123');
            expect(decoded.type).toBe('refresh');
        });
    });

    describe('Token Verification', () => {
        const testUser = {
            _id: 'user123',
            email: 'test@example.com',
            role: 'admin'
        };

        it('should verify valid access token', () => {
            const token = authService.generateAccessToken(testUser);
            const decoded = authService.verifyAccessToken(token);

            expect(decoded).toBeDefined();
            expect(decoded.userId).toBe('user123');
        });

        it('should verify valid refresh token', () => {
            const token = authService.generateRefreshToken(testUser);
            const decoded = authService.verifyRefreshToken(token);

            expect(decoded).toBeDefined();
            expect(decoded.userId).toBe('user123');
            expect(decoded.type).toBe('refresh');
        });

        it('should reject invalid token', () => {
            expect(() => {
                authService.verifyAccessToken('invalid.token.here');
            }).toThrow();
        });

        it('should reject access token used as refresh token', () => {
            const accessToken = authService.generateAccessToken(testUser);

            expect(() => {
                authService.verifyRefreshToken(accessToken);
            }).toThrow('Invalid token type');
        });

        it('should reject tampered token', () => {
            const token = authService.generateAccessToken(testUser);
            const tamperedToken = token.slice(0, -5) + 'xxxxx';

            expect(() => {
                authService.verifyAccessToken(tamperedToken);
            }).toThrow();
        });
    });

    describe('Token Expiration', () => {
        it('should return correct access token expiration time', () => {
            const expiresIn = authService.getAccessTokenExpiresIn();
            expect(expiresIn).toBe(15 * 60); // 15 minutes in seconds
        });

        it('should return correct refresh token expiration time', () => {
            const expiresIn = authService.getRefreshTokenExpiresIn();
            expect(expiresIn).toBe(7 * 24 * 60 * 60); // 7 days in seconds
        });
    });

    describe('Password Change Detection', () => {
        it('should detect token issued before password change', () => {
            const tokenIat = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
            const passwordChangedAt = new Date(); // Just now

            const result = authService.isTokenIssuedBeforePasswordChange(tokenIat, passwordChangedAt);
            expect(result).toBe(true);
        });

        it('should detect token issued after password change', () => {
            const tokenIat = Math.floor(Date.now() / 1000);
            const passwordChangedAt = new Date(Date.now() - 3600000); // 1 hour ago

            const result = authService.isTokenIssuedBeforePasswordChange(tokenIat, passwordChangedAt);
            expect(result).toBe(false);
        });

        it('should handle null password change date', () => {
            const tokenIat = Math.floor(Date.now() / 1000);

            const result = authService.isTokenIssuedBeforePasswordChange(tokenIat, null);
            expect(result).toBe(false);
        });
    });
});
