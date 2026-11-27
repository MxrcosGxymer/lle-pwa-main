/// <reference path="../.astro/types.d.ts" />

declare const __BUILD_SHA__: string;

declare namespace App {
	interface Locals {
		admin?: {
			username: string;
			role: 'admin' | 'referee';
		};
	}
}
