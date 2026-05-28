import { describe, expect, it } from 'bun:test'
import { createCorsOriginChecker } from './corsOrigins'

describe('createCorsOriginChecker', () => {
    it('allows requests without Origin header', () => {
        const isAllowed = createCorsOriginChecker(['https://hub.example.com'])
        expect(isAllowed(null)).toBe(true)
        expect(isAllowed(undefined)).toBe(true)
    })

    it('supports allow-all wildcard', () => {
        const isAllowed = createCorsOriginChecker(['*'])
        expect(isAllowed('http://localhost:5173')).toBe(true)
        expect(isAllowed('https://evil.example')).toBe(true)
        expect(isAllowed('null')).toBe(true)
    })

    it('matches exact origins', () => {
        const isAllowed = createCorsOriginChecker(['https://hub.example.com'])
        expect(isAllowed('https://hub.example.com')).toBe(true)
        expect(isAllowed('https://hub.example.com:443')).toBe(false)
    })

    it('matches wildcard port patterns', () => {
        const isAllowed = createCorsOriginChecker(['http://localhost:*'])
        expect(isAllowed('http://localhost:5173')).toBe(true)
        expect(isAllowed('http://localhost:12345')).toBe(true)
        expect(isAllowed('http://localhost')).toBe(true)
        expect(isAllowed('https://localhost:5173')).toBe(false)
        expect(isAllowed('http://127.0.0.1:5173')).toBe(false)
    })
})

