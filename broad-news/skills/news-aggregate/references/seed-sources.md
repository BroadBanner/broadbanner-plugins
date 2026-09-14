# Seed Sources

Global seed list of news outlets used when a creator has no custom source registry.
Scores reflect general editorial reliability — creators' personal scores diverge over time
based on their usage patterns.

## Wire Services &amp; Major Outlets

| Domain             | Name                  | RSS URL                                          | Initial Score | Tags                     |
| ------------------ | --------------------- | ------------------------------------------------ | ------------- | ------------------------ |
| reuters.com        | Reuters               | https://www.reuters.com/rssfeed/topNews           | 0.92          | wire, intl, breaking     |
| apnews.com         | Associated Press      | https://rsshub.app/apnews/topics/apf-topnews     | 0.91          | wire, intl, breaking     |
| bbc.com            | BBC News              | https://feeds.bbci.co.uk/news/world/rss.xml       | 0.88          | intl, uk, analysis       |
| theguardian.com    | The Guardian          | https://www.theguardian.com/world/rss             | 0.85          | intl, uk, progressive    |
| aljazeera.com      | Al Jazeera            | https://www.aljazeera.com/xml/rss/all.xml         | 0.84          | intl, middle-east        |
| npr.org            | NPR                   | https://feeds.npr.org/1001/rss.xml                | 0.86          | us, radio, analysis      |
| pbs.org            | PBS NewsHour          | https://www.pbs.org/newshour/feeds/rss/headlines   | 0.87          | us, tv, analysis         |

## Investigative &amp; In-Depth

| Domain             | Name                  | RSS URL                                          | Initial Score | Tags                     |
| ------------------ | --------------------- | ------------------------------------------------ | ------------- | ------------------------ |
| propublica.org     | ProPublica            | https://www.propublica.org/feeds/propublica/main  | 0.90          | investigative, us        |
| theintercept.com   | The Intercept         | https://theintercept.com/feed/?rss                | 0.82          | investigative, natl-sec  |
| motherjones.com    | Mother Jones          | https://www.motherjones.com/feed/                 | 0.78          | investigative, progressive|

## Policy &amp; Geopolitics

| Domain             | Name                  | RSS URL                                          | Initial Score | Tags                     |
| ------------------ | --------------------- | ------------------------------------------------ | ------------- | ------------------------ |
| foreignaffairs.com | Foreign Affairs       | —                                                | 0.88          | geopolitics, policy      |
| warontherocks.com  | War on the Rocks      | https://warontherocks.com/feed/                   | 0.85          | defense, geopolitics     |
| csis.org           | CSIS                  | https://www.csis.org/rss.xml                      | 0.86          | think-tank, defense      |
| crisisgroup.org    | Intl Crisis Group     | https://www.crisisgroup.org/rss.xml               | 0.87          | conflict, intl           |
| lawfaremedia.org   | Lawfare               | https://www.lawfaremedia.org/feed                 | 0.84          | legal, natl-sec          |

## Tech &amp; Surveillance

| Domain             | Name                  | RSS URL                                          | Initial Score | Tags                     |
| ------------------ | --------------------- | ------------------------------------------------ | ------------- | ------------------------ |
| themarkup.org      | The Markup            | https://themarkup.org/feeds/rss.xml               | 0.86          | tech, surveillance, data |
| arstechnica.com    | Ars Technica          | https://feeds.arstechnica.com/arstechnica/index   | 0.82          | tech, policy             |
| eff.org            | EFF                   | https://www.eff.org/rss/updates.xml               | 0.83          | tech, civil-liberties    |

## Notes

- RSS URLs marked — require web search fallback (paywalled or no public feed)
- Scores are starting points — the scoring engine adjusts per-creator over time
- Tags are used for keyword-to-source affinity (e.g., "Iran" → middle-east, geopolitics)
- Creators can add custom sources via the BannerBlast management page or gateway API
