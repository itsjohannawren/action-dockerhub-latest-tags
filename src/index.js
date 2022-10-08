const core = require ("@actions/core");

const DEFAULT_MAX_PAGES = 0;
const DEFAULT_NUMBER_OF_TAGS = 2;

function get_input_variable (name, default_value) {
	let value = core.getInput (name) || null;

	if (
		(value === null) &&
		(default_value !== undefined)
	) {
		value = default_value;
	} else if (
		(value === null) &&
		(default_value === undefined)
	) {
		throw new Error ("Input variable '" + name + "' not specified!");
	}

	value = value.toString ().trim ();

	if (value.match (/^\d+/)) {
		value = parseInt (value, 10)
	} else if (value.match (/^\d+\.\d+/)) {
		value = parseFloat (value)
	} else if (value.toLowerCase () == "true") {
		value = true
	} else if (value.toLowerCase () == "false") {
		value = false
	}

	return (value);
}

function parse_image (data) {
	if (! data) {
		throw new Error ("image is required");
	}

	let image_parts = data.split ("/");
	let author;
	let image;

	if (image_parts.length == 1) {
		author = "library";
		image = image_parts [0];
	} else if (image_parts.length == 2) {
		[author, image] = image_parts;
	} else {
		throw new Error ("Invalid image format, must be <ORGINIZATION>/<IMAGE>");
	}

	return [author, image];
}

async function request (author, image, page) {
	const url = "https://registry.hub.docker.com/v2/repositories/" + author + "/" + image + "/tags?page=" + page;

	console.log ("Requesting: " + url);
	const response = await fetch (url);
	const response_text = await response.text ();


	console.log ("   Response status: " + response.status);
	console.log ("   Response length: " + response_text.length);

	if (response.status !== 200) {
		throw new Error("Non-success status code received: " + response.status);
	}

	return (response_text);
}

function has_next (data) {
	const metadata = JSON.parse (data);

	if (metadata.next === null) {
		return (false);
	} else {
		return (true);
	}
}

function extract_images (data) {
	const metadata = JSON.parse (data);
	let images = []

	for (let result of metadata.results) {
		for (let image of result.images) {
			if (result.name.match (/^\d+\.\d+\.\d+$/)) {
				images.push ({
					"tag": result.name,
					"group": result.name.replace (/\.\d+$/, ""),
					"platform": image.os + "/" + image.architecture + (
						image.variant === null ? "" : "/" + image.variant
					)
				});
			}
		}
	}

	return (images);
}

async function fetch_images (organization, image, max_pages) {
	let page = 1;
	let images = []

	while (
		(max_pages == 0) || (
			(max_pages != 0) &&
			(page <= max_pages)
		)
	) {
		const response_body = await request (organization, image, page);
		const _images = extract_images (response_body);
		images = images.concat (_images)
		if (! has_next (response_body)) {
			break;
		}
		page++;
	}

	return (images);
}

function digest_images (images, number_of_tags) {
	const semantic_sort = (a, b) => {
		a_parts = a.split (".");
		b_parts = b.split (".");

		for (i = 0;; i++) {
			if (
				(a_parts [i] === undefined) &&
				(b_parts [i] === undefined)
			) {
				return (0);
			} else if (
				(a_parts [i] === undefined) &&
				(b_parts [i] !== undefined)
			) {
				return (-1);
			} else if (
				(a_parts [i] !== undefined) &&
				(b_parts [i] === undefined)
			) {
				return (1);
			} else if (parseInt (a_parts [i], 10) > parseInt (b_parts [i], 10)) {
				return (1);
			} else if (parseInt (a_parts [i], 10) < parseInt (b_parts [i], 10)) {
				return (-1);
			}
		}
	};
	const semantic_sort_tag = (a, b) => {
		return (semantic_sort (
			a.tag,
			b.tag
		));
	};

	let groups = {};
	for (image of images) {
		if (groups [image.group] === undefined) {
			groups [image.group] = []
		}
		groups [image.group].push (image)
	}

	group_keys = Object.keys (groups)
	group_keys.sort (semantic_sort);
	group_keys.reverse ();

	group_keys = group_keys.slice (0, number_of_tags);

	let tags = [];
	for (group_key of group_keys) {
		groups [group_key].sort (semantic_sort_tag);
		groups [group_key].reverse ();
		const group_version = groups [group_key][0].tag;

		platforms = [];
		for (image of groups [group_key]) {
			if (image.tag === group_version) {
				platforms.push (image.platform);
			}
		}
		tags.push ({
			"version": group_version,
			"tags": [
				group_version,
				groups [group_key][0].group
			],
			"platforms": platforms
		});
	}

	return (tags);
}

async function main () {
	try {
		const input_image = get_input_variable ('image', null);
		const [image_organization, image_name] = parse_image (input_image);

		const input_max_pages = get_input_variable ('max_pages', DEFAULT_MAX_PAGES);
		let max_pages = DEFAULT_MAX_PAGES;
		if (! isNaN (input_max_pages)) {
			max_pages = input_max_pages;
		}

		const input_number_of_tags = get_input_variable ('number_of_tags', DEFAULT_NUMBER_OF_TAGS);
		let number_of_tags = DEFAULT_NUMBER_OF_TAGS;
		if (! isNaN (input_number_of_tags)) {
			number_of_tags = input_number_of_tags;
		}

		const images = await fetch_images (image_organization, image_name, max_pages);
		const tags = digest_images (images, number_of_tags)

		core.setOutput ('tags', tags);
	} catch (err) {
		core.setFailed (err.message);
	}
}

main ();
