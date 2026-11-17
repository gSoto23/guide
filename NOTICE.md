# Third-party notices

## GeoNames

`packages/domain/src/properties/time-zone-data.ts` includes city names and time zones derived from
the GeoNames `cities15000` dataset (https://www.geonames.org/), licensed under the
[Creative Commons Attribution 4.0 License](https://creativecommons.org/licenses/by/4.0/). The data
was filtered to countries with more than one time zone and reduced to accent-folded names. It is
used only to suggest a property's time zone; no address leaves Guidesk.

## IANA time zone database

The same file includes country-to-zone data from `zone1970.tab` in the IANA time zone database
(https://www.iana.org/time-zones), which is in the public domain.
