"""
Category rules for MAPC OSM Explorer.

Each feature in OSM is assigned ONE primary category based on its tags.
Rules are evaluated in priority order — first match wins.

This keeps v1 simple: a feature belongs to exactly one category. We can
add secondary-category support in v1.5 if planners need it.

Priority ordering rationale:
  Specific amenities (school, hospital, restaurant) beat generic ones
  (building, landuse) so that e.g. a building tagged amenity=school
  lands in Community Facilities, not Buildings & Addresses.
"""

# Each rule: (slug, label, SQL predicate against a `tags` MAP<VARCHAR,VARCHAR>)
# Evaluated top-to-bottom; first match wins.
CATEGORY_RULES = [
    (
        "public-safety-and-health",
        "Public Safety & Health",
        """
        tags['amenity'] IN ('hospital','clinic','doctors','dentist','pharmacy',
                            'police','fire_station','ambulance_station','nursing_home')
        OR tags['healthcare'] IS NOT NULL
        OR tags['emergency'] IS NOT NULL
        """,
    ),
    (
        "transit",
        "Transit",
        """
        tags['highway'] = 'bus_stop'
        OR tags['railway'] IN ('station','halt','subway_entrance','tram_stop','platform')
        OR tags['public_transport'] IN ('stop_position','platform','station','stop_area')
        OR tags['amenity'] IN ('bus_station','ferry_terminal','taxi')
        OR tags['aeroway'] IN ('aerodrome','terminal','helipad')
        """,
    ),
    (
        "food-access",
        "Food Access",
        """
        tags['shop'] IN ('supermarket','convenience','grocery','greengrocer',
                         'butcher','bakery','farm','seafood','deli')
        OR tags['amenity'] IN ('restaurant','cafe','fast_food','food_court','marketplace')
        OR tags['landuse'] = 'farmland'
        """,
    ),
    (
        "civic-and-government",
        "Civic & Government",
        """
        tags['amenity'] IN ('townhall','courthouse','post_office','public_building')
        OR tags['office'] IN ('government','diplomatic')
        OR tags['government'] IS NOT NULL
        """,
    ),
    (
        "community-facilities",
        "Community Facilities",
        """
        tags['amenity'] IN ('school','library','community_centre','college','university',
                            'kindergarten','childcare','place_of_worship','social_facility',
                            'theatre','arts_centre','cinema','events_venue')
        OR tags['leisure'] = 'community_centre'
        """,
    ),
    (
        "parks-and-recreation",
        "Parks & Recreation",
        """
        tags['leisure'] IN ('park','playground','pitch','sports_centre','swimming_pool',
                            'fitness_centre','golf_course','dog_park','nature_reserve',
                            'track','stadium','garden','fishing','beach_resort','marina',
                            'water_park','ice_rink','bandstand')
        OR tags['tourism'] IN ('camp_site','picnic_site','viewpoint','zoo','theme_park',
                               'attraction','museum')
        OR tags['natural'] = 'beach'
        OR tags['boundary'] IN ('national_park','protected_area')
        """,
    ),
    (
        "active-transportation",
        "Active Transportation",
        """
        tags['highway'] IN ('cycleway','path','footway','pedestrian','steps','bridleway',
                            'track')
        OR tags['cycleway'] IS NOT NULL
        OR tags['route'] IN ('bicycle','foot','hiking','mtb')
        OR tags['amenity'] IN ('bicycle_parking','bicycle_rental','bicycle_repair_station')
        """,
    ),
    (
        "streetscape",
        "Streetscape",
        """
        tags['amenity'] IN ('bench','waste_basket','drinking_fountain','fountain','shelter',
                            'toilets','parking','parking_space','bicycle_parking',
                            'vending_machine','telephone','post_box','charging_station')
        OR tags['highway'] IN ('street_lamp','crossing','traffic_signals','stop','give_way',
                               'speed_camera','traffic_sign','motorway_junction')
        OR tags['barrier'] IS NOT NULL
        OR tags['tactile_paving'] IS NOT NULL
        OR tags['traffic_calming'] IS NOT NULL
        """,
    ),
    (
        "natural-features-and-green-infrastructure",
        "Natural Features & Green Infrastructure",
        """
        tags['natural'] IS NOT NULL
        OR tags['waterway'] IS NOT NULL
        OR tags['landuse'] IN ('forest','meadow','grass','recreation_ground','village_green',
                               'cemetery','orchard','vineyard','allotments')
        OR tags['water'] IS NOT NULL
        """,
    ),
    (
        "streets-and-roadways",
        "Streets & Roadways",
        """
        tags['highway'] IN ('motorway','trunk','primary','secondary','tertiary',
                            'unclassified','residential','service','motorway_link',
                            'trunk_link','primary_link','secondary_link','tertiary_link',
                            'living_street','road','busway')
        """,
    ),
    (
        "housing-and-land-use",
        "Housing & Land Use",
        """
        tags['landuse'] IS NOT NULL
        OR tags['place'] IN ('neighbourhood','suburb','quarter','village','hamlet','town',
                             'city','locality')
        """,
    ),
    (
        "buildings-and-addresses",
        "Buildings & Addresses",
        """
        tags['building'] IS NOT NULL
        OR tags['addr:housenumber'] IS NOT NULL
        OR tags['addr:street'] IS NOT NULL
        """,
    ),
]


def build_category_case_sql() -> str:
    """Emit a single SQL CASE expression that classifies each feature."""
    branches = []
    for slug, _label, predicate in CATEGORY_RULES:
        branches.append(f"        WHEN ({predicate.strip()}) THEN '{slug}'")
    return "CASE\n" + "\n".join(branches) + "\n        ELSE NULL\n      END"


CATEGORIES = [
    {"slug": slug, "label": label} for slug, label, _ in CATEGORY_RULES
]
