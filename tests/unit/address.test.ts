import { Address } from '../../src/core/types/Address';
import { getAddress } from 'ethers';

describe('Address', () => {
    test('constructor throws on invalid address', () => {
        expect(() => new Address('invalid')).toThrow('Invalid Ethereum address: invalid');
    });

    test('checksum returns correct EIP-55 address', () => {
        const addr = new Address('0x52908400098527886E0F7030069857D2E4169EE7');
        expect(addr.checksum).toBe(getAddress('0x52908400098527886E0F7030069857D2E4169EE7'));
    });

    test('lower returns lowercase address', () => {
        const addr = new Address('0x52908400098527886E0F7030069857D2E4169EE7');
        expect(addr.lower).toBe('0x52908400098527886e0f7030069857d2e4169ee7');
    });

    test('equals returns true for same address instances', () => {
        const a1 = new Address('0x52908400098527886E0F7030069857D2E4169EE7');
        const a2 = new Address('0x52908400098527886E0F7030069857D2E4169EE7');
        expect(a1.equals(a2)).toBe(true);
    });

    test('equals returns true for same address string', () => {
        const a = new Address('0x52908400098527886E0F7030069857D2E4169EE7');
        expect(a.equals('0x52908400098527886e0f7030069857d2e4169ee7')).toBe(true);
    });

    test('equals returns false for different addresses', () => {
        const a = new Address('0x52908400098527886E0F7030069857D2E4169EE7');
        const b = new Address('0x8617E340B3D01FA5F11F306F4090FD50E238070D');
        expect(a.equals(b)).toBe(false);
    });

    test('equals() should be case-insensitive', () => {
        const addr1 = new Address('0xabc1234567890123456789012345678901234567');
        const addr2 = new Address('0xABC1234567890123456789012345678901234567');

        expect(addr1.equals(addr2)).toBe(true);
        expect(addr2.equals(addr1)).toBe(true);
    });
});
